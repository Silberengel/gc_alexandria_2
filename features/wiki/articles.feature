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
      | AsciiDoc | [[#Publications|label]]      |
    When I follow that link from a wiki article or a publication section
    Then I open /search?d=constantinople
    And the lookup is an explicit #d search for wiki, spec, publication, long-form, and directory events
    And the link is a real hyperlink, not raw [[…]] or Markdown left in AsciiDoc
    And [[#Section|label]] becomes an in-page link that scrolls to that article's section heading without leaving the page (hash routes cannot use a bare #fragment)

  Scenario: Spec documents are readable
    Given a 30817 with d-tag "nip-54"
    When I open it
    Then I can read the specification body
    And the body is rendered as Markdown (headings, lists, links)
    And the header does not repeat the raw Markdown source as a summary
    And the published-by avatar stays badge-sized

  Scenario: Long-form articles are readable
    Given a kind 30023 with d-tag "living-like-god-in-france"
    When I open /article/d/living-like-god-in-france/p/{npub}
    Then I can read the article body
    And the body is rendered as Markdown (headings, lists, links)
    And the reading header shows a horizontal hero (image tag or magazine cover) with title and author overlaid
    And when the body repeats that same hero image near the top, the body copy is not shown again
    And search and profile cards for it use the same wiki/spec card layout labeled Article
    And the generated cover is a magazine plate (not wiki parchment or spec blueprint)
    And a kind 30023 with a t-tag recipe, recipes, zapcooking, chefstr, foodstr, or nostrcooking, or a client tag Zap Cooking, uses a recipe-book placeholder instead of that magazine plate
    And a Zap Cooking client recipe lists https://zap.cooking/recipe/{its naddr} as a header source

  Scenario: Wiki page shows header, body, and interactions
    When I open a wiki article
    Then I see the header card and the body
    And below that I see kind 1111 threads for that article
    And kind 1 replies that e-tag or a-tag the article or those comments
    And kind 1 notes that q-tag the article appear under Quotes
    And kind 9802 highlights for this article are marked inline in the body with a highlighter avatar
    And I do not see a separate Highlights list under the article
    And I do not see kind 34259 ratings
    When I type into the page filter
    Then matching text in the article is highlighted and the page jumps to it

  Scenario: Deference forwards to the preferred version
    Given a kind 30818 article A defers to article B with an a-tag or e-tag marker defer
    And other versions C and D also defer to B
    When I open A's /wiki/d/{d}/p/{npub}
    Then I am forwarded to B
    And I see a "Deferred to by" list with userbadges for A, C, and D
    And I do not see the placeholder body "Read nostr:naddr instead."
    When A appears as a search or versions card
    Then I see "The author defers to another version" instead of the raw naddr placeholder
    And I can open the preferred version from that notice
