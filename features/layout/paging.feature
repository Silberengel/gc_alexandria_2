@mvp
Feature: Card paging
  As a visitor
  I want lists to page instead of dumping everything
  So that home, search, and profiles stay light

  Background:
    Given card lists show 25 per page, current page only, loading when they enter view
    And search results stop at 100
    And each shelf shows at most 50 covers
    And the highlight list has at most 50 entries
    And What we are discussing shows at most 200 comments

  Scenario: Lists are paged and capped
    When I open home, search, or a profile
    Then I see at most one page of cards at a time
    And those caps hold
