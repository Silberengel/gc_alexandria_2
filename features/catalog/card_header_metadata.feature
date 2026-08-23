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
    And title is every title-tag, else every T-tag, omitted if neither; each opens /search as an explicit title lookup (Mercury title and T; relays #T)
    And subject is every t-tag, omitted if none; each opens /search as an explicit #t lookup
    And summary is the summary-tag, else a short content excerpt, omitted if neither
    And source is the first s-tag, else the first source-tag, omitted if neither; it opens that URL and not /search
    And clicking the card or cover outside those field links opens that edition or wiki page

  Scenario: Identifier and language stay on the full page
    Given an event has i or l tags
    When I see it as a search, shelf, landing, or bookshelf card
    Then those values are hidden
    When I open its full /publication/ or /wiki/ page
    Then the header shows them
    And an i-tag opens /search for that identifier as an explicit identifier lookup
    And an l-tag opens /search for that language as an explicit language lookup
