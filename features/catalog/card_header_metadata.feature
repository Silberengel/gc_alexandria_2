@mvp
Feature: Publication and wiki card metadata
  As a visitor
  I want cards and headers to show publisher, authors, titles, topics, and source
  So that I can search those terms and still credit Gutenberg, Open Library, and Wikipedia

  Background:
    Given these fields apply to kind 30040, 30818, and 30817 cards and headers
    And i and l tags appear only on the full-page header, never on search, shelf, landing, or bookshelf cards

  Scenario: Field sources and clicks
    When I see a publication or wiki card or header
    Then published by is a userbadge for the signing pubkey
    And author is every author-tag, else every N-tag, omitted if neither; each opens /search as an explicit author lookup (Mercury author and N; relays #N)
    And title is every title-tag, else every T-tag, omitted if neither
    And on a card the title and cover open that edition or wiki page
    And the summary is plain text (not a link)
    And on a full-page header each title opens /search as an explicit title lookup (Mercury title and T; relays #T)
    And subject is every t-tag, omitted if none; each opens /search as an explicit #t lookup
    And summary is the summary-tag, else a short content excerpt, omitted if neither
    And card and header summaries are plain text with AsciiDoc and Markdown markup stripped
    And source is the first s-tag, else the first source-tag, omitted if neither; it opens that URL and not /search
    And clicking author or subject field links still opens /search; other card chrome opens the edition or wiki page
    And publication cards are labeled Publication with book-style covers
    And wiki and spec cards are labeled Wiki or Spec with parchment-style covers so they are easy to tell apart

  Scenario: Identifier and language stay on the full page
    Given an event has i or l tags
    When I see it as a search, shelf, landing, or bookshelf card
    Then those values are hidden
    When I open its full /publication/ or /wiki/ page
    Then the header shows them
    And an i-tag opens /search for that identifier as an explicit identifier lookup
    And an l-tag language value is shown as a labeled fact with a search link

  Scenario: Full edition header is thorough like a library card
    When I open a /publication/ edition page
    Then I see the cover beside the bibliographic block on a wide viewport
    And I see titles, authors with roles when present, the Nostr publisher badge, and summary
    And type, imprint, version, section count, and release date appear as labeled facts (not search chips)
    And language appears as a labeled fact with a search link when present
    And I see a Sources section for the source URL and every i-tag (ISBN is searchable/copyable; Open Library, Gutenberg, Wikidata and similar resolve to external links)
    And a non-URL source string is a plain source label
    And subject t-tags appear under Topics as #links
    And shelf and Read actions are grouped separately from those labels
    And L NIP-32 namespace tags are not shown as the language
    When I opened that page from a shelf or search card that already showed the edition
    Then that header paints from the known event before any relay round-trip
