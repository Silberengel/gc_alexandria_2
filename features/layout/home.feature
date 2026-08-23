@mvp
Feature: Library home
  As a visitor
  I want a search-first landing page
  So that I can start like on Open Library or Goodreads

  Scenario: Home is a library landing page
    When I open the home page
    Then a global search bar for Nostr events is at the top of the landing content
    And I see cover-focused bookshelves when any shelf has items, even if there is only one
    And I do not see publication cards on the landing page
    And I see the highlight list and What we are discussing, side by side on a wide screen
    And then subject buttons
    And then publication-label buttons
    And I do not see a kind-1 timeline
