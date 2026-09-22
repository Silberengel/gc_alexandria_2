@mvp
Feature: What we are discussing
  As a visitor
  I want the newest comments on books and wiki pages
  So that I can see conversation without a social timeline

  Background:
    Given comments are kind 1111 NIP-22 events
    And this feed includes only comments whose root or parent is 30040, 30041, 30818, or 30817
    And it uses the social/interaction read selector
    And the work title opens that publication or wiki at the top
    And View comment opens it with ?comment={id} and scrolls to that comment
    And a comment on a 30041 opens the parent 30040
    And each work appears once, with only its newest comment
    And the landing page shows at most 10 of those comments

  Scenario: The feed is titled
    When I open the home page
    Then I see a section titled "What we are discussing"
    And comments are newest created_at first

  Scenario: One newest comment per work
    Given work J has an older comment, a reply, and a newer comment
    When I open the home page
    Then J appears once
    And that row is the newest comment
    And replies in J's thread are omitted

  Scenario: A row names the work and the commenter
    When a comment in the feed targets a publication or wiki
    Then the work or wiki title is the link to the page top
    And the commenter's userbadge sits above the muted excerpt under the title
    And a View comment control deep-links to that comment

  Scenario: A section comment names the edition
    When a comment targets a 30041 section
    Then the title is "Publication Title: Section Title"
    And the title opens the parent 30040 at the top
    And View comment opens the parent 30040 with ?comment={id} and scrolls to that comment
