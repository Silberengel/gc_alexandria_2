@mvp
Feature: Landing publication highlights
  As a visitor
  I want the newest highlights on book editions
  So that I can see what people are quoting

  Background:
    Given highlights are kind 9802 NIP-84 events
    And a publication or section highlight references an a-tag kind:pubkey:d-tag
    And an a-tag on 30040 is that edition; an a-tag on 30041 rolls up to its parent 30040
    And an i-tag as the highlight source is for websites, not publications, and is omitted here
    And this list reads the document/search and social/interaction selectors
    And clicking a row opens that edition's /publication/d/{d}/p/{npub}
    And the landing page shows at most 10 of those highlights

  Scenario: One newest highlight per edition
    Given edition G has an older highlight and a newer highlight
    And another 30040 shares G's i-tag but not its a-tag
    When I open the home page
    Then each entry is a different edition a-tag
    And G shows only the newer highlight
    And the other i-tag copy is a separate row if it has its own 9802
    And entries are ordered by that newest highlight's created_at

  Scenario: A row is usable
    Given three different npubs have highlighted edition H via a-tags
    And one of those npubs highlighted it twice
    When I open the home page
    Then the publication title is the link to the left of the publisher's userbadge
    And the highlighter's userbadge sits above the muted excerpt, indented under the title

  Scenario: A section highlight names the edition
    When a highlight's a-tag is a 30041 section
    Then the title is "Publication Title: Section Title"
    And clicking it opens the parent 30040
