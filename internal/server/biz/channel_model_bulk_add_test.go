package biz

import (
	"context"
	"io"
	"net/http"
	"strings"
	"testing"
	"time"

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

func TestModelFetcher_CleanInvalidChannelModels(t *testing.T) {
	nativeClient := &http.Client{Transport: channelModelRoundTripFunc(func(req *http.Request) (*http.Response, error) {
		auth := req.Header.Get("Authorization")
		var body string
		switch {
		case strings.Contains(auth, "key-a"):
			body = `{"data":[{"id":"model-1"},{"id":"model-3"}]}`
		case strings.Contains(auth, "key-b"):
			body = `{"data":[]}`
		default:
			return &http.Response{
				StatusCode: http.StatusUnauthorized,
				Body:       io.NopCloser(strings.NewReader(`{"error":"unauthorized"}`)),
			}, nil
		}

		return &http.Response{
			StatusCode: http.StatusOK,
			Header:     http.Header{"Content-Type": []string{"application/json"}},
			Body:       io.NopCloser(strings.NewReader(body)),
		}, nil
	})}

	svc, client := setupTestChannelService(t)
	defer client.Close()

	ctx := authz.WithTestBypass(ent.NewContext(context.Background(), client))
	createChannel := func(name string, apiKey string, supportedModels []string) *ent.Channel {
		ch, err := client.Channel.Create().
			SetName(name).
			SetType(channel.TypeOpenai).
			SetBaseURL("https://api.example.com").
			SetCredentials(objects.ChannelCredentials{APIKey: apiKey}).
			SetSupportedModels(supportedModels).
			SetDefaultTestModel("model-1").
			Save(ctx)
		require.NoError(t, err)
		return ch
	}

	chA := createChannel("ChannelA", "key-a", []string{"model-1", "model-2"})
	chB := createChannel("ChannelB", "key-b", []string{"model-1"})
	chC := createChannel("ChannelC", "", []string{"model-1"})

	fetcher := NewModelFetcher(httpclient.NewHttpClientWithClient(nativeClient), svc)
	
	// Start task asynchronously
	_, err := fetcher.CleanInvalidChannelModels(ctx)
	require.NoError(t, err)

	// Since we run in a goroutine, let's wait a small amount of time for the goroutine to actually acquire the lock or start.
	// Or we can just sleep a few milliseconds.
	time.Sleep(50 * time.Millisecond)

	// Wait for the background task to complete (it runs very fast in test since there's no actual delay)
	// We can try to lock f.cleanMu to wait for it.
	fetcher.cleanMu.Lock()
	fetcher.cleanMu.Unlock()

	// Get final status
	payload := fetcher.GetCleanInvalidChannelModelsStatus(ctx)
	require.True(t, payload.Finished)
	require.False(t, payload.Running)
	require.Empty(t, payload.Error)

	require.Equal(t, 3, payload.Scanned)
	require.Equal(t, 3, payload.Total)
	require.Equal(t, 1, payload.Cleaned)
	require.Equal(t, 1, payload.RemovedAssociations)
	require.Len(t, payload.Failures, 1)
	require.Equal(t, chC.ID, payload.Failures[0].ChannelID)

	chA, err = client.Channel.Get(ctx, chA.ID)
	require.NoError(t, err)
	require.Equal(t, []string{"model-1"}, chA.SupportedModels)

	chB, err = client.Channel.Get(ctx, chB.ID)
	require.NoError(t, err)
	require.Equal(t, []string{"model-1"}, chB.SupportedModels)

	chC, err = client.Channel.Get(ctx, chC.ID)
	require.NoError(t, err)
	require.Equal(t, []string{"model-1"}, chC.SupportedModels)
}
