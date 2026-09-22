@mvp
Feature: Card paging
  As a visitor
  I want lists to page instead of dumping everything
  So that home, search, and profiles stay light

  Background:
    Given card lists show 25 per page in full and compact views, current page only, loading when they enter view
    And table view pages at 250 events
    And search results stop at 100
    And each shelf shows at most 50 covers in full and compact views
    And the highlight list has at most 10 entries
    And the rating list has at most 10 entries
    And What we are discussing shows at most 10 comments

  Scenario: Lists are paged and capped
    When I open home, search, or a profile
    Then I see at most one page of cards or table rows at a time
    And those caps hold
