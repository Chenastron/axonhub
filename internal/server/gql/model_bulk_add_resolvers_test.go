package gql

import (
	"context"
	"testing"

	"github.com/stretchr/testify/require"

	"github.com/looplj/axonhub/internal/ent"
	"github.com/looplj/axonhub/internal/server/biz"
)

func TestChannelModelDiscoveryIDResolvers(t *testing.T) {
	t.Parallel()

	resolver := &Resolver{}
	candidateResolver := &channelModelCandidateChannelResolver{resolver}
	failureResolver := &channelModelDiscoveryFailureResolver{resolver}

	candidateID, err := candidateResolver.ID(context.Background(), &biz.ChannelModelCandidateChannel{ID: 42})
	require.NoError(t, err)
	require.Equal(t, ent.TypeChannel, candidateID.Type)
	require.Equal(t, 42, candidateID.ID)

	failureID, err := failureResolver.ChannelID(context.Background(), &biz.ChannelModelDiscoveryFailure{ChannelID: 84})
	require.NoError(t, err)
	require.Equal(t, ent.TypeChannel, failureID.Type)
	require.Equal(t, 84, failureID.ID)
}
