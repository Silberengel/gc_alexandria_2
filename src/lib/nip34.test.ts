import { describe, expect, it } from 'vitest';
import type { Event } from 'nostr-tools';
import { KIND } from './constants';
import {
  gitRepoAuthorityPubkeys,
  issueBody,
  gitRepoDTagVariants,
  issueBelongsToRepo,
  issueRepoCoordinate,
  repoIssueAddressVariants,
  issueSubject,
  parseGitRepository,
  resolveIssueStatus
} from './nip34';

function ev(partial: Partial<Event> & Pick<Event, 'kind' | 'pubkey'>): Event {
  return {
    id: (partial.id ?? 'a'.repeat(64)).slice(0, 64),
    created_at: partial.created_at ?? 1_700_000_000,
    content: partial.content ?? '',
    tags: partial.tags ?? [],
    sig: 'c'.repeat(128),
    ...partial
  };
}

describe('parseGitRepository', () => {
  it('parses NIP-34 repository announcement tags', () => {
    const repo = parseGitRepository(
      ev({
        kind: KIND.GIT_REPO,
        pubkey: 'f'.repeat(64),
        tags: [
          ['d', 'alexandria'],
          ['name', 'Alexandria'],
          ['description', 'A Nostr library'],
          ['web', 'https://example.com', 'https://alt.example'],
          ['clone', 'https://git.example/alexandria.git'],
          ['relays', 'wss://relay.example'],
          ['maintainers', 'b'.repeat(64)],
          ['r', 'deadbeef', 'euc'],
          ['t', 'nostr']
        ]
      })
    );
    expect(repo?.identifier).toBe('alexandria');
    expect(repo?.name).toBe('Alexandria');
    expect(repo?.webUrls).toEqual(['https://example.com', 'https://alt.example']);
    expect(repo?.cloneUrls).toEqual(['https://git.example/alexandria.git']);
    expect(repo?.relays).toEqual(['wss://relay.example']);
    expect(repo?.maintainers).toEqual(['b'.repeat(64)]);
    expect(repo?.earliestUniqueCommit).toBe('deadbeef');
    expect(repo?.topics).toEqual(['nostr']);
  });
});

describe('issue subject / body', () => {
  it('prefers subject tag, else Subject: prefix', () => {
    expect(
      issueSubject(
        ev({
          kind: KIND.ISSUE,
          pubkey: 'f'.repeat(64),
          content: 'body only',
          tags: [['subject', 'Tagged title']]
        })
      )
    ).toBe('Tagged title');
    expect(
      issueSubject(
        ev({
          kind: KIND.ISSUE,
          pubkey: 'f'.repeat(64),
          content: 'Subject: Prefixed\n\nDetails'
        })
      )
    ).toBe('Prefixed');
    expect(
      issueBody(
        ev({
          kind: KIND.ISSUE,
          pubkey: 'f'.repeat(64),
          content: 'Subject: Prefixed\n\nDetails'
        })
      )
    ).toBe('Details');
  });

  it('reads the repo a-tag coordinate', () => {
    expect(
      issueRepoCoordinate(
        ev({
          kind: KIND.ISSUE,
          pubkey: 'f'.repeat(64),
          tags: [['a', `30617:${'c'.repeat(64)}:Alexandria`]]
        })
      )
    ).toBe(`30617:${'c'.repeat(64)}:Alexandria`);
  });

  it('matches issues when the repo d-tag casing differs', () => {
    const owner = 'c'.repeat(64);
    const repo = ev({
      kind: KIND.GIT_REPO,
      pubkey: owner,
      tags: [['d', 'alexandria'], ['name', 'Alexandria']]
    });
    const issue = ev({
      kind: KIND.ISSUE,
      pubkey: 'f'.repeat(64),
      tags: [['a', `30617:${owner}:Alexandria`], ['p', owner]]
    });
    expect(issueBelongsToRepo(issue, repo)).toBe(true);
    expect(gitRepoDTagVariants('alexandria')).toEqual(['alexandria', 'Alexandria']);
    expect(repoIssueAddressVariants(repo)).toEqual([
      `30617:${owner}:alexandria`,
      `30617:${owner}:Alexandria`
    ]);
  });
});

describe('resolveIssueStatus', () => {
  const owner = '1'.repeat(64);
  const maintainer = '2'.repeat(64);
  const stranger = '3'.repeat(64);
  const author = '4'.repeat(64);
  const issueId = 'b'.repeat(64);

  const issue = ev({
    id: issueId,
    kind: KIND.ISSUE,
    pubkey: author,
    content: 'Subject: Bug\n\nBroken',
    tags: [['a', `30617:${owner}:repo`]]
  });

  const repo = ev({
    kind: KIND.GIT_REPO,
    pubkey: owner,
    tags: [
      ['d', 'repo'],
      ['maintainers', maintainer]
    ]
  });

  const authority = gitRepoAuthorityPubkeys(repo);

  it('defaults to Open', () => {
    const status = resolveIssueStatus(issue, [], authority);
    expect(status.id).toBe('open');
    expect(status.event).toBeNull();
  });

  it('accepts the newest status from author or maintainer', () => {
    const older = ev({
      id: 'c'.repeat(64),
      kind: KIND.ISSUE_STATUS_CLOSED,
      pubkey: author,
      created_at: 100,
      tags: [['e', issueId, '', 'root']]
    });
    const newer = ev({
      id: 'd'.repeat(64),
      kind: KIND.ISSUE_STATUS_RESOLVED,
      pubkey: maintainer,
      created_at: 200,
      tags: [['e', issueId, '', 'root']]
    });
    const ignored = ev({
      id: 'e'.repeat(64),
      kind: KIND.ISSUE_STATUS_DRAFT,
      pubkey: stranger,
      created_at: 300,
      tags: [['e', issueId, '', 'root']]
    });
    const status = resolveIssueStatus(issue, [older, ignored, newer], authority);
    expect(status.id).toBe('resolved');
    expect(status.label).toBe('Resolved');
    expect(status.event?.id).toBe(newer.id);
  });
});
