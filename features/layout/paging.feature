@mvp
Feature: Card paging
  As a visitor
  I want lists to page instead of dumping everything
  So that home, search, and profiles stay light

  Background:
    Given card lists show 24 per page in full and compact views (3-column grid, no orphan row), current page only, loading when they enter view
    And table view pages at 250 events
    And search results stop at 100
    And each shelf shows at most 50 covers in full and compact views
    And the highlight list has at most 10 entries
    And the rating list has at most 10 entries
    And What we are discussing shows at most 10 comments
    And when there is more than one page the pager shows << < numbered pages > >> (first, previous, next, last)
    And numbered buttons include the first and last page, a window around the current page, and ellipses when pages are skipped
    And the current page is marked with an underline accent

  Scenario: Lists are paged and capped
    When I open home, search, or a profile
    Then I see at most one page of cards or table rows at a time
    And those caps hold

  Scenario: Pager jumps to ends and middle pages
    Given a search or table list with more than one page
    When I click <<
    Then I am on page 1
    When I click a numbered page button
    Then I jump to that page
    When I click >>
    Then I am on the final page
