@mvp
Feature: Search
  As a visitor
  I want /search to resolve addresses and catalog tags without hammering relays
  So that books, wiki, and people are found through NIP-01, Mercury, and cache

  Background:
    Given NIP-01 filters support ids, authors, kinds, and single-letter tags only
    And Mercury POST /api/events/filter accepts NIP-01 keys including #d #T #N #i #l #s #t
    And Mercury POST /api/publications/search matches title and T, author and N, plus identifier, d, q, language, subject
    And Mercury POST /api/wiki/search matches d, T, title, author, N, s, i, and body
    And Mercury POST /api/publications/sections/search matches d, T, title, author, N, and body
    And Mercury POST /api/suggest is typeahead on T N d i title author
    And relay NIP-01 tag filters for search are only #d #T #N
    And #title and #author are never sent as NIP-01 tags
    And searches run in parallel against cache, Mercury HTTP, and the matching relay stacks on the shared pool
    And a repeat of the same query paints the last snapshot immediately, then refreshes from API and relays
    And cards render as each source returns; the page does not wait for every EOSE or for full-text
    And a top-level 30040 is one not referenced by another 30040's a-tag
    And a subindex is a 30040 that is referenced by another 30040's a-tag
    And kind 30040 results prefer top-level hits and show subindexes only when no top-level 30040 matched

  Scenario: Landing search goes to /search
    When I submit a query from the landing global search bar
    Then I am on /search
    And I see result cards as they arrive
    And those cards are horizontal, with the full cover on the left, summary when present, and two per row on a laptop
    And I do not see bookshelves, landing highlights, What we are discussing, subject buttons, or label buttons

  Scenario: Typeahead uses Mercury suggest
    When I type "mans" into search
    Then I see "Mansfield Park" among suggestions without waiting for a relay EOSE

  Scenario: Bech32 and 64-hex are recognized from the typed string
    Given an optional nostr: prefix is stripped before recognition
    When I search /search with one of:
      | input    | lookup                                                       |
      | 64-hex   | ids and authors in parallel, cache then stacks and API       |
      | naddr    | kind+author+#d on the matching stack and API                 |
      | nevent   | ids                                                          |
      | note     | ids                                                          |
    Then that is the only lookup
    And I do not fan out to #d #T #N #i #l #t #s or full-text
    And matching events from cache, API, document stack, and social stack can appear as cards as they arrive

  Scenario: nsec is not a search
    When I type or submit an nsec
    Then it is not decoded
    And it is not sent to relays, Mercury, or the cache as a query
    And it is not used as a signer

  Scenario: Other typed queries fan out
    When I search /search with a string that is not bech32 or 64-hex
    Then lookups run in parallel
    And relays receive only #d, #T, and #N
    And Mercury is queried for title and T, author and N, plus identifier, d, language, subject, and s
    And identifier and URL expansion can match
    And cards from those lookups can appear before full-text returns

  Scenario: Full-text arrives late on API and cache
    When a fan-out search runs
    Then Mercury sections/search and wiki/search are queried with q
    And the client cache is scanned for matching content
    And NIP-01 WebSockets are not used as a full-text engine
    And full-text hits can appear after other cards are already visible

  Scenario: Identifier and URL search
    When I search for one of:
      | query                                |
      | 141                                  |
      | gutenberg:141                        |
      | https://www.gutenberg.org/ebooks/141 |
    Then "Mansfield Park" appears via Mercury identifier / s expansion
    And that query is fan-out, not 64-hex recognition
    And relays are not sent #i or #s for it

  Scenario: Explicit tag searches do not fan out
    When I open /search from a subject button or by clicking an author, title, subject, identifier, or language on a card or header
    Then the lookup is that field only
    And an author click queries Mercury author and N, and relays only #N
    And a title click queries Mercury title and T, and relays only #T
    And I do not also run full-text or the other tag fans

  Scenario: A landing label is not a language search
    When I open /search from a landing label button
    Then the lookup is kind 1985 with #l equal to that label
    And targeted publications appear as result cards
    And I do not query Mercury language or publication #l as if it were an ISO language
    And I do not also run full-text or the other tag fans

  Scenario: Publication and wiki lookups
    When I open a /publication/ or /wiki/ route
    Then the lookup uses cache, Mercury, and the matching stack
    And a publication row is that edition's naddr card
    And a direct naddr of a nested 30040 still opens that subindex

  Scenario: Clicking a result card opens that page
    When I click a publication result card
    Then I open that edition at /publication/d/{d}/p/{npub}
    When I click a wiki or spec result card
    Then I open that page at /wiki/d/{d}/p/{npub}

  Scenario: Search results are ordered
    When a search has more matching cards than one page
    Then later-arriving cards fill remaining slots up to the paging caps
    And publication cards with at least two sections are ordered above publications with fewer
    And within that, newest created_at first

  Scenario: Searching an npub or nprofile opens their profile
    When I search with an npub or nprofile
    Then I go to /p/ for that pubkey
    And I do not stay on /search with that author's events
