@mvp
Feature: Wiki
  As a visitor
  I want encyclopedia pages with other versions and wikilinks
  So that index and relay wiki read as one corpus

  Background:
    Given wiki and spec pages are kind 30818 and 30817 only
    And there is no kind 30819

  Scenario: Versions share a d-tag
    Given the index has a 30818 with d-tag "istanbul"
    And a relay has another 30818 with the same d-tag
    When I open /wiki/d/istanbul
    Then I see both versions and can tell which is the library copy
    When I choose one
    Then I am on /wiki/d/istanbul/p/{npub} and I see the body

  Scenario: Wikilinks open a d-tag search
    Given a body contains a wikilink written as one of:
      | markup   | form                         |
      | Djot     | [[constantinople]]           |
      | Djot     | [[constantinople|Byzantium]] |
      | Djot     | [constantinople][]           |
      | Markdown | [[constantinople]]           |
      | Markdown | [[constantinople|Byzantium]] |
      | AsciiDoc | [[constantinople]]           |
      | AsciiDoc | [[constantinople|Byzantium]] |
    When I follow that link from a wiki article or a publication section
    Then I open /search?d=constantinople
    And the lookup is an explicit #d search for wiki, spec, publication, and directory events
    And the link is a real hyperlink, not raw [[…]] or Markdown left in AsciiDoc

  Scenario: Spec documents are readable
    Given a 30817 with d-tag "nip-54"
    When I open it
    Then I can read the specification body
    And the body is rendered as Markdown (headings, lists, links)
    And the header does not repeat the raw Markdown source as a summary
    And the published-by avatar stays badge-sized

  Scenario: Wiki page shows header, body, and interactions
    When I open a wiki article
    Then I see the header card and the body
    And below that I see kind 9802 highlights whose a-tag is this article and kind 1111 threads for that article
    And I do not see kind 34259 ratings
    When I type into the page filter
    Then matching text in the article is highlighted and the page jumps to it

  Scenario: Deference forwards to the preferred version
    Given a kind 30818 article A defers to article B with an a-tag or e-tag marker defer
    When I open A's /wiki/d/{d}/p/{npub}
    Then I am forwarded to B
    And I see a banner "Deferred to by:" with A's userbadge
    And I do not see the placeholder body "Read nostr:naddr instead."
