@mvp
Feature: Listing full, compact grid, and table views
  As a reader
  I want icon buttons to switch between full, compact, and table layouts
  So that shelves and result pages can match jumble's library density toggle and bulk scanning

  Background:
    Given listing density is full, list (compact grid), or table and persists in this browser
    And full is the default
    And the same density applies on home shelves, search results, and profile produced/interacted lists
    And three icon buttons toggle full (detailed), compact grid, and table

  Scenario: Home shelves honor density
    When I open the home page and shelves are present
    Then I see full, compact-grid, and table view icon buttons
    And in full view each shelf is a horizontal cover shelf-bar
    And in compact grid view each shelf is a responsive grid of compact publication cells (cover, title, author)
    And that compact grid is one column on a phone, two from tablet width, and up to three on a wide screen
    And in table view all shelf publications appear in one Title/Author table (deduped, no shelf sections)
    And table view pages at 250 events

  Scenario: Search and profile listings honor density
    When I open search results or a profile with produced or interacted works
    Then I see the same full, compact-grid, and table view icon buttons
    And in full view I see detailed event cards (up to three columns on a wide screen)
    And in compact grid view I see compact cells in that same responsive column count
    And in table view I see one sortable Title/Author table for all entries (profile merges produced and interacted), paging at 250
