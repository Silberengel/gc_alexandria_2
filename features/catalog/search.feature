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
    And searches run in parallel against cache, Mercury HTTP, the matching relay stacks on the shared pool, and Brainstorm NIP-50 full-text
    And Brainstorm search uses wss://search-staging.brainstorm.world only, with observer, sort:rank, and trust-filter extensions that are never sent to other relays
    And a repeat of the same query paints the last snapshot immediately, then refreshes from API and relays
    And cards render as each source returns; the page does not wait for every EOSE or for full-text
    And a top-level 30040 is one not referenced by another 30040's a-tag
    And a subindex is a 30040 that is referenced by another 30040's a-tag
    And kind 30040 results prefer top-level hits and show subindexes only when no top-level 30040 matched
    And when GrapeRank scores are available, search ranks by section boost, then author GrapeRank, then newest created_at
    And when the Trust filter is on and scores hydrated, authors below the GrapeRank minimum are hidden (self and follows never; unknown-rank follows-of-follows soft-pass)

  Scenario: Landing search goes to /search
    When I submit a query from the landing global search bar
    Then I am on /search
    And I see the search term at the top
    And I see result cards as they arrive
    And publication covers show the book-icon badge when that index has a/e tags (merges keep the richer tag set so thin search hits do not hide it)
    And each card has a more menu to copy its nevent or naddr and open it on njump.me or jumble.imwald.eu
    And unfamiliar kinds show a kind line, a title only when a title tag is present (≤100, plaintext), author, and plaintext body from content (≤250, markup stripped)
    And full, compact-grid, and table layout icon buttons switch density (persisted with home and profile)
    And in full view those cards are horizontal, with the full cover on the left, summary when present, and up to three per row on a wide screen
    And result cards are cropped to at most 500px tall
    And in compact grid view results are compact cells in that same responsive column count
    And in table view results are a sortable text table with no pictures, paging at 250
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
    When I open /search from a subject button or by clicking an author, subject, identifier, or language on a card or header, or a title on a full-page header
    Then the lookup is that field only
    And an author click queries Mercury author and N, and relays only #N
    And a title click from a header queries Mercury title and T, and relays only #T
    And I do not also run full-text or the other tag fans

  Scenario: A wikilink d-tag search is explicit
    When I open /search?d={slug} from a wikilink
    Then the lookup is #d equal to the normalized slug
    And kinds include 30040, 30041, 30818, 30817, and 30045
    And full-text mention hits may still appear
    And publication cards with that d-tag appear first among publications
    And the wiki card with that d-tag appears first among wiki and spec cards, ahead of mention-only hits

  Scenario: A landing label is not a language search
    When I open /search from a landing label button
    Then the lookup is kind 1985 with #l equal to that label
    And targeted publications appear as result cards
    And I do not query Mercury language or publication #l as if it were an ISO language
    And I do not also run full-text or the other tag fans

  Scenario: A profile read count opens an author-scoped read list
    When I open /search?read={npub}
    Then the lookup is kind 1985 by that author with #l equal to read
    And targeted publications appear as result cards
    And I do not treat read as a public landing or label search
    And I do not also run full-text or the other tag fans

  Scenario: A nested bookshelf search is explicit
    When I open /search?bookshelf={d}
    Then the lookup is kind 30045 with that d-tag on the document stack
    And targeted publications appear as result cards
    And Untitled or deleted targets are omitted from those cards
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
    And publication cards are ordered above wiki and spec cards
    And within that, cards whose d-tag equals the query slug (for ?d= / wikilink search) are ordered above other matches
    And within that, publication cards with at least two sections are ordered above publications with fewer
    And within that, higher GrapeRank authors are ordered above lower or unknown when scores are available
    And within that, newest created_at first

  Scenario: Fan-out includes Brainstorm full-text
    When a fan-out search runs
    Then NIP-50 full-text is queried on wss://search-staging.brainstorm.world for publication and wiki kinds
    And that REQ includes observer and sort:rank
    And when Trust filter is on, it includes filter:rank:gte with the configured minimum
    And when Trust filter is off, it includes include:spam
    And those Brainstorm extensions are not sent to Mercury or the document/search stack

  Scenario: Searching an npub or nprofile opens their profile
    When I search with an npub or nprofile
    Then I go to /p/ for that pubkey
    And I do not stay on /search with that author's events
