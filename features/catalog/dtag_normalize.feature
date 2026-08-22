@mvp
Feature: d-tag normalization
  As a visitor
  I want dots, underscores, spaces, and hyphens to mean the same slug
  So that wikilinks, /wiki/d/, /publication/d/, and d-tag search find the same pages

  Background:
    Given normalization lowercases letters that have case
    And space, ".", "_", and "-" each become "-"
    And other punctuation is removed, not concatenated
    And consecutive "-" are collapsed and edges are trimmed
    And letters and numbers are kept, including non-ASCII
    And the same function is used for wiki slugs, publication d routes, wikilink targets, and d-tag search

  Scenario: Separators fold to a single hyphen
    When I normalize one of:
      | input                  | slug                   |
      | Bitcoin Wallet         | bitcoin-wallet         |
      | Sphinx.Chat            | sphinx-chat            |
      | sphinx_chat            | sphinx-chat            |
      | already-hyphenated     | already-hyphenated     |
      | mix.ed_separators-here | mix-ed-separators-here |
      |   Hello   World        | hello-world            |
      | What's Up?             | whats-up               |
      | NKBIP-01               | nkbip-01               |
      | Ñoño                   | ñoño                   |
      | ウィキペディア         | ウィキペディア         |
    Then I get that slug
    And Sphinx.Chat is not folded to sphinxchat

  Scenario: Unnormalized paths and searches still resolve
    When I open /wiki/d/Sphinx.Chat or /publication/d/pg141.mansfield_park
    Then the lookup uses the normalized #d
    And the address bar shows the normalized slug
    When I search /search for "Sphinx.Chat"
    Then the fan-out #d lookup uses "sphinx-chat"
