@mvp
Feature: What we are discussing
  As a visitor
  I want the newest comments on books and wiki pages
  So that I can see conversation without a social timeline

  Background:
    Given comments are kind 1111 NIP-22 events
    And this feed includes only comments whose root or parent is 30040, 30041, 30818, or 30817
    And it uses the social/interaction read selector
    And clicking a row opens that publication or wiki
    And a comment on a 30041 opens the parent 30040

  Scenario: The feed is titled
    When I open the home page
    Then I see a section titled "What we are discussing"
    And comments are newest created_at first

  Scenario: A row names the work and the commenter
    When a comment in the feed targets a publication or wiki
    Then the row shows an excerpt, the commenter's userbadge, and the work or wiki title
