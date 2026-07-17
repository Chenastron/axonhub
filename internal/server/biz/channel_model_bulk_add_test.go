package biz

import (
	"context"
	"io"
	"net/http"
	"strings"
	"testing"

	"github.com/stretchr/testify/require"

	"github.com/looplj/axonhub/internal/authz"
	"github.com/looplj/axonhub/internal/ent"
	"github.com/looplj/axonhub/internal/ent/channel"
	"github.com/looplj/axonhub/internal/objects"
	"github.com/looplj/axonhub/llm/httpclient"
)

type channelModelRoundTripFunc func(*http.Request) (*http.Response, error)

func (f channelModelRoundTripFunc) RoundTrip(req *http.Request) (*http.Response, error) {
	return f(req)
}

func TestModelTokensMatch(t *testing.T) {
	t.Parallel()

	tests := []struct {
		name      string
		query     string
		candidate string
		want      bool
	}{
		{name: "case and provider prefix", query: "GPT-5.6", candidate: "openai/gpt-5-6-thinking", want: true},
		{name: "letter digit boundary", query: "gpt5.6", candidate: "GPT-5-6", want: true},
		{name: "candidate contained by query", query: "anthropic claude 4 5 reasoning", candidate: "claude-4.5", want: true},
		{name: "different version", query: "gpt-5.6", candidate: "gpt-5.7-thinking", want: false},
		{name: "different family", query: "gpt-5.6", candidate: "claude-5-6", want: false},
		{name: "empty query", query: "", candidate: "gpt-5.6", want: false},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			t.Parallel()
			require.Equal(t, tt.want, modelTokensMatch(tokenizeModelID(tt.query), tokenizeModelID(tt.candidate)))
		})
	}
}

func TestModelFetcher_DiscoverChannelModelCandidates(t *testing.T) {
	nativeClient := &http.Client{Transport: channelModelRoundTripFunc(func(_ *http.Request) (*http.Response, error) {
		return &http.Response{
			StatusCode: http.StatusOK,
			Header:     http.Header{"Content-Type": []string{"application/json"}},
			Body: io.NopCloser(strings.NewReader(
				`{"data":[{"id":"openai/gpt-5-6-thinking"},{"id":"GPT-5-6"},{"id":"GPT-5-6"},{"id":"claude-4-5"}]}`,
			)),
		}, nil
	})}

	svc, client := setupTestChannelService(t)
	defer client.Close()

	ctx := authz.WithTestBypass(ent.NewContext(context.Background(), client))
	createChannel := func(name string, status channel.Status, apiKey string, supportedModels []string) *ent.Channel {
		ch, err := client.Channel.Create().
			SetName(name).
			SetType(channel.TypeOpenai).
			SetBaseURL("https://models.example").
			SetCredentials(objects.ChannelCredentials{APIKey: apiKey}).
			SetSupportedModels(supportedModels).
			SetDefaultTestModel("existing-model").
			SetStatus(status).
			Save(ctx)
		require.NoError(t, err)
		return ch
	}

	enabled := createChannel("Enabled", channel.StatusEnabled, "key-enabled", []string{"openai/gpt-5-6-thinking"})
	disabled := createChannel("Disabled", channel.StatusDisabled, "key-disabled", nil)
	archived := createChannel("Archived", channel.StatusArchived, "key-archived", nil)
	failed := createChannel("Failed", channel.StatusDisabled, "", nil)

	fetcher := NewModelFetcher(httpclient.NewHttpClientWithClient(nativeClient), svc)
	result, err := fetcher.DiscoverChannelModelCandidates(ctx, "GPT-5.6")
	require.NoError(t, err)
	require.Equal(t, 4, result.Scanned)
	require.Equal(t, 3, result.Succeeded)
	require.Len(t, result.Failures, 1)
	require.Equal(t, failed.ID, result.Failures[0].ChannelID)
	require.Contains(t, result.Failures[0].Error, "API key is required")
	require.Len(t, result.Candidates, 2)

	candidates := make(map[string][]int, len(result.Candidates))
	for _, candidate := range result.Candidates {
		for _, ch := range candidate.Channels {
			candidates[candidate.ModelID] = append(candidates[candidate.ModelID], ch.ID)
		}
	}
	require.ElementsMatch(t, []int{disabled.ID, archived.ID}, candidates["openai/gpt-5-6-thinking"])
	require.ElementsMatch(t, []int{enabled.ID, disabled.ID, archived.ID}, candidates["GPT-5-6"])
}

func TestChannelService_BulkAddChannelModels(t *testing.T) {
	svc, client := setupTestChannelService(t)
	defer client.Close()

	previousAsyncReloadDisabled := asyncReloadDisabled
	asyncReloadDisabled = true
	defer func() { asyncReloadDisabled = previousAsyncReloadDisabled }()

	ctx := authz.WithTestBypass(ent.NewContext(context.Background(), client))
	createChannel := func(name string, models, manualModels []string) *ent.Channel {
		ch, err := client.Channel.Create().
			SetName(name).
			SetType(channel.TypeOpenai).
			SetBaseURL("https://api.example.com").
			SetCredentials(objects.ChannelCredentials{APIKey: "key"}).
			SetSupportedModels(models).
			SetManualModels(manualModels).
			SetDefaultTestModel("existing").
			Save(ctx)
		require.NoError(t, err)
		return ch
	}

	first := createChannel("First", []string{"existing", "gpt-5-6"}, []string{"manual-only"})
	second := createChannel("Second", []string{"existing"}, nil)

	payload, err := svc.BulkAddChannelModels(ctx, []*ChannelModelAddSelectionInput{
		{ModelID: "gpt-5-6", ChannelIDs: []int{first.ID, second.ID, second.ID}},
		{ModelID: "openai/gpt-5-6-thinking", ChannelIDs: []int{first.ID, second.ID}},
	})
	require.NoError(t, err)
	require.Equal(t, 2, payload.SelectedModels)
	require.Equal(t, 2, payload.UpdatedChannels)
	require.Equal(t, 3, payload.AddedAssociations)

	first, err = client.Channel.Get(ctx, first.ID)
	require.NoError(t, err)
	require.Equal(t, []string{"existing", "gpt-5-6", "openai/gpt-5-6-thinking"}, first.SupportedModels)
	require.Equal(t, []string{"manual-only"}, first.ManualModels)

	second, err = client.Channel.Get(ctx, second.ID)
	require.NoError(t, err)
	require.Equal(t, []string{"existing", "gpt-5-6", "openai/gpt-5-6-thinking"}, second.SupportedModels)
	require.Empty(t, second.ManualModels)

	payload, err = svc.BulkAddChannelModels(ctx, []*ChannelModelAddSelectionInput{
		{ModelID: "gpt-5-6", ChannelIDs: []int{first.ID, second.ID}},
	})
	require.NoError(t, err)
	require.Equal(t, 0, payload.UpdatedChannels)
	require.Equal(t, 0, payload.AddedAssociations)
}

func TestChannelService_BulkAddChannelModelsRollsBackForMissingChannel(t *testing.T) {
	svc, client := setupTestChannelService(t)
	defer client.Close()

	ctx := authz.WithTestBypass(ent.NewContext(context.Background(), client))
	ch, err := client.Channel.Create().
		SetName("Existing").
		SetType(channel.TypeOpenai).
		SetBaseURL("https://api.example.com").
		SetCredentials(objects.ChannelCredentials{APIKey: "key"}).
		SetSupportedModels([]string{"existing"}).
		SetDefaultTestModel("existing").
		Save(ctx)
	require.NoError(t, err)

	_, err = svc.BulkAddChannelModels(ctx, []*ChannelModelAddSelectionInput{
		{ModelID: "gpt-5-6", ChannelIDs: []int{ch.ID, 999999}},
	})
	require.ErrorContains(t, err, "expected to find 2 channels")

	ch, err = client.Channel.Get(ctx, ch.ID)
	require.NoError(t, err)
	require.Equal(t, []string{"existing"}, ch.SupportedModels)
}
