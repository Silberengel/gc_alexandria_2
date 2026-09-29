@mvp
Feature: Listing full and table views
  As a reader
  I want icon buttons to switch between full card and table layouts
  So that shelves and result pages can match jumble's library density toggle and bulk scanning

  Background:
    Given listing density is full or table and persists in this browser
    And full is the default
    And the same density applies on home shelves, search results, and profile produced/interacted lists
    And two icon buttons toggle full (detailed cards) and table

  Scenario: Home shelves honor density
    When I open the home page and shelves are present
    Then I see full and table view icon buttons
    And in full view each shelf is a horizontal cover shelf-bar
    And in table view all shelf publications appear in one Title/Author/Publisher table with a small cover thumbnail (deduped, no shelf sections)
    And table view pages at 240 rows
    And full card grids page at 48

  Scenario: Search and profile listings honor density
    When I open search results or a profile with produced or interacted works
    Then I see the same full and table view icon buttons
    And in full view I see detailed event cards (up to three columns on a wide screen)
    And in table view I see one sortable Title/Author/Publisher table with cover thumbnails for all entries (profile merges produced and interacted), paging at 240
    And full card grids page at 48
