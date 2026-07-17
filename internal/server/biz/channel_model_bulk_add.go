package biz

import (
	"context"
	"fmt"
	"sort"
	"strings"
	"unicode"

	"golang.org/x/sync/errgroup"

	"github.com/looplj/axonhub/internal/ent"
	"github.com/looplj/axonhub/internal/ent/channel"
)

const maxConcurrentChannelModelDiscovery = 8

type ChannelModelCandidateChannel struct {
	ID     int            `json:"id"`
	Name   string         `json:"name"`
	Status channel.Status `json:"status"`
}

type ChannelModelCandidate struct {
	ModelID  string                          `json:"modelID"`
	Channels []*ChannelModelCandidateChannel `json:"channels"`
}

type ChannelModelDiscoveryFailure struct {
	ChannelID   int    `json:"channelID"`
	ChannelName string `json:"channelName"`
	Error       string `json:"error"`
}

type ChannelModelDiscoveryResult struct {
	Scanned    int                             `json:"scanned"`
	Succeeded  int                             `json:"succeeded"`
	Candidates []*ChannelModelCandidate        `json:"candidates"`
	Failures   []*ChannelModelDiscoveryFailure `json:"failures"`
}

type channelModelDiscoveryFetchResult struct {
	channel *ent.Channel
	models  []ModelIdentify
	err     string
}

// DiscoverChannelModelCandidates fetches upstream model lists for all channels
// and returns only matching model IDs that are not already configured.
func (f *ModelFetcher) DiscoverChannelModelCandidates(ctx context.Context, modelName string) (*ChannelModelDiscoveryResult, error) {
	queryTokens := tokenizeModelID(modelName)
	if len(queryTokens) == 0 {
		return nil, fmt.Errorf("model name is required")
	}

	channels, err := f.channelService.entFromContext(ctx).Channel.Query().All(ctx)
	if err != nil {
		return nil, fmt.Errorf("failed to query channels: %w", err)
	}

	fetchResults := make(chan channelModelDiscoveryFetchResult, len(channels))
	var group errgroup.Group
	group.SetLimit(maxConcurrentChannelModelDiscovery)

	for _, ch := range channels {
		ch := ch
		group.Go(func() error {
			result, fetchErr := f.FetchModels(ctx, FetchModelsInput{
				ChannelType: ch.Type.String(),
				BaseURL:     ch.BaseURL,
				ChannelID:   &ch.ID,
			})
			if fetchErr != nil {
				fetchResults <- channelModelDiscoveryFetchResult{channel: ch, err: fetchErr.Error()}
				return nil
			}
			if result.Error != nil {
				fetchResults <- channelModelDiscoveryFetchResult{channel: ch, err: *result.Error}
				return nil
			}

			fetchResults <- channelModelDiscoveryFetchResult{channel: ch, models: result.Models}
			return nil
		})
	}

	_ = group.Wait()
	close(fetchResults)

	result := &ChannelModelDiscoveryResult{Scanned: len(channels)}
	candidateChannels := make(map[string][]*ChannelModelCandidateChannel)

	for fetched := range fetchResults {
		if fetched.err != "" {
			result.Failures = append(result.Failures, &ChannelModelDiscoveryFailure{
				ChannelID:   fetched.channel.ID,
				ChannelName: fetched.channel.Name,
				Error:       fetched.err,
			})
			continue
		}

		result.Succeeded++
		existingModels := make(map[string]struct{}, len(fetched.channel.SupportedModels))
		for _, modelID := range fetched.channel.SupportedModels {
			existingModels[modelID] = struct{}{}
		}

		seenFetchedModels := make(map[string]struct{}, len(fetched.models))
		for _, model := range fetched.models {
			if _, seen := seenFetchedModels[model.ID]; seen {
				continue
			}
			seenFetchedModels[model.ID] = struct{}{}

			if _, exists := existingModels[model.ID]; exists || !modelTokensMatch(queryTokens, tokenizeModelID(model.ID)) {
				continue
			}

			candidateChannels[model.ID] = append(candidateChannels[model.ID], &ChannelModelCandidateChannel{
				ID:     fetched.channel.ID,
				Name:   fetched.channel.Name,
				Status: fetched.channel.Status,
			})
		}
	}

	modelIDs := make([]string, 0, len(candidateChannels))
	for modelID := range candidateChannels {
		modelIDs = append(modelIDs, modelID)
	}
	sort.Slice(modelIDs, func(i, j int) bool {
		left := strings.ToLower(modelIDs[i])
		right := strings.ToLower(modelIDs[j])
		if left == right {
			return modelIDs[i] < modelIDs[j]
		}
		return left < right
	})

	for _, modelID := range modelIDs {
		matchedChannels := candidateChannels[modelID]
		sort.Slice(matchedChannels, func(i, j int) bool {
			left := strings.ToLower(matchedChannels[i].Name)
			right := strings.ToLower(matchedChannels[j].Name)
			if left == right {
				return matchedChannels[i].ID < matchedChannels[j].ID
			}
			return left < right
		})
		result.Candidates = append(result.Candidates, &ChannelModelCandidate{
			ModelID:  modelID,
			Channels: matchedChannels,
		})
	}

	sort.Slice(result.Failures, func(i, j int) bool {
		left := strings.ToLower(result.Failures[i].ChannelName)
		right := strings.ToLower(result.Failures[j].ChannelName)
		if left == right {
			return result.Failures[i].ChannelID < result.Failures[j].ChannelID
		}
		return left < right
	})

	return result, nil
}

func tokenizeModelID(value string) []string {
	var (
		tokens  []string
		current []rune
		kind    int
	)

	flush := func() {
		if len(current) == 0 {
			return
		}
		tokens = append(tokens, strings.ToLower(string(current)))
		current = current[:0]
	}

	for _, r := range strings.TrimSpace(value) {
		nextKind := 0
		switch {
		case unicode.IsLetter(r):
			nextKind = 1
		case unicode.IsDigit(r):
			nextKind = 2
		default:
			flush()
			kind = 0
			continue
		}

		if kind != 0 && kind != nextKind {
			flush()
		}
		current = append(current, r)
		kind = nextKind
	}
	flush()

	return tokens
}

func modelTokensMatch(query, candidate []string) bool {
	if len(query) == 0 || len(candidate) == 0 {
		return false
	}
	return containsTokenSequence(candidate, query) || containsTokenSequence(query, candidate)
}

func containsTokenSequence(tokens, sequence []string) bool {
	if len(sequence) > len(tokens) {
		return false
	}
	for start := 0; start <= len(tokens)-len(sequence); start++ {
		matched := true
		for index := range sequence {
			if tokens[start+index] != sequence[index] {
				matched = false
				break
			}
		}
		if matched {
			return true
		}
	}
	return false
}

type ChannelModelAddSelectionInput struct {
	ModelID    string `json:"modelID"`
	ChannelIDs []int  `json:"channelIDs"`
}

type BulkAddChannelModelsPayload struct {
	SelectedModels    int `json:"selectedModels"`
	UpdatedChannels   int `json:"updatedChannels"`
	AddedAssociations int `json:"addedAssociations"`
}

// BulkAddChannelModels appends selected upstream model IDs to channels in one transaction.
func (svc *ChannelService) BulkAddChannelModels(ctx context.Context, selections []*ChannelModelAddSelectionInput) (*BulkAddChannelModelsPayload, error) {
	channelModels := make(map[int][]string)
	selectedModels := make(map[string]struct{})

	for _, selection := range selections {
		if selection == nil {
			return nil, fmt.Errorf("selection is required")
		}
		modelID := selection.ModelID
		if strings.TrimSpace(modelID) == "" {
			return nil, fmt.Errorf("model ID is required")
		}
		if len(selection.ChannelIDs) == 0 {
			return nil, fmt.Errorf("at least one channel is required for model %q", modelID)
		}

		selectedModels[modelID] = struct{}{}
		for _, channelID := range selection.ChannelIDs {
			if channelID <= 0 {
				return nil, fmt.Errorf("invalid channel ID %d", channelID)
			}
			if !containsString(channelModels[channelID], modelID) {
				channelModels[channelID] = append(channelModels[channelID], modelID)
			}
		}
	}

	payload := &BulkAddChannelModelsPayload{SelectedModels: len(selectedModels)}
	if len(channelModels) == 0 {
		return payload, nil
	}

	channelIDs := make([]int, 0, len(channelModels))
	for channelID := range channelModels {
		channelIDs = append(channelIDs, channelID)
	}
	sort.Ints(channelIDs)

	err := svc.RunInTransaction(ctx, func(ctx context.Context) error {
		channels, err := svc.entFromContext(ctx).Channel.Query().
			Where(channel.IDIn(channelIDs...)).
			All(ctx)
		if err != nil {
			return fmt.Errorf("failed to query target channels: %w", err)
		}
		if len(channels) != len(channelIDs) {
			return fmt.Errorf("expected to find %d channels, but found %d", len(channelIDs), len(channels))
		}

		channelsByID := make(map[int]*ent.Channel, len(channels))
		for _, ch := range channels {
			channelsByID[ch.ID] = ch
		}

		for _, channelID := range channelIDs {
			ch := channelsByID[channelID]
			nextModels := append([]string(nil), ch.SupportedModels...)
			added := 0
			for _, modelID := range channelModels[channelID] {
				if containsString(nextModels, modelID) {
					continue
				}
				nextModels = append(nextModels, modelID)
				added++
			}
			if added == 0 {
				continue
			}

			if _, err := svc.entFromContext(ctx).Channel.UpdateOneID(channelID).
				SetSupportedModels(nextModels).
				Save(ctx); err != nil {
				return fmt.Errorf("failed to update channel %d: %w", channelID, err)
			}
			payload.UpdatedChannels++
			payload.AddedAssociations += added
		}

		return nil
	})
	if err != nil {
		return nil, err
	}

	if payload.UpdatedChannels > 0 {
		svc.asyncReloadChannels()
	}

	return payload, nil
}

func containsString(values []string, target string) bool {
	for _, value := range values {
		if value == target {
			return true
		}
	}
	return false
}
