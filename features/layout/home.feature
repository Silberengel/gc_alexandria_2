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

  Scenario: Signed-in reading now
    Given I am signed in with a kind 16374 queue
    When I open the home page
    Then I see Reading now excerpt cards for the active concurrent subset (first N from Settings)
    And each card has cover, title, progress, excerpt at pos, and Continue into the reader
    And Continue opens the reader at that book's tracked section (or pos), not the edition top
    And active queue editions and nearby stream pages are warmed into the client event cache for offline reopen
    And Up next lists waiting books with Read now to move one to the front of the queue
