@mvp
Feature: Nested bookshelves (NKBIP-04)
  As a signed-in reader
  I want personal nested 30045 directories for publications
  So that my Bookshelf matches jumble and imwald-android

  Background:
    Given a bookshelf is a kind 30045 directory with d-tag my-book-collection at the root
    And nested shelves are empty 30045 events linked from a parent via an a-tag
    And membership a-tags are Android-safe: coordinate, optional relay, 4th field is a 64-hex event id
    And only d, a, and e tags are written on bookshelf directories
    And a directory holds at most 500 a/e children
    And nested folders walk at most 8 levels deep
    And a replaceable 30045 is not published until the existing one is loaded or confirmed missing
    And empty nested shelves have no title tag
    And bookshelf reads use the document/search stack
    And bookshelf writes use personal write relays

  Scenario: Signed-in user toggles the root bookshelf
    Given I am signed in
    When I add a publication to My bookshelf from an edition page
    Then a kind 30045 with d=my-book-collection is published targeting that publication
    And it appears on my home shelf after reload
    When I remove it
    Then that membership a-tag is gone
    And other children remain

  Scenario: Signed-in user creates a nested shelf
    Given I am signed in
    When I create a new bookshelf named Summer Reads and add the publication
    Then an empty 30045 with a slugified d-tag is published
    And the root my-book-collection a-tags that nested directory
    And the nested directory a-tags the publication
    And a home row for that nested shelf appears when it has covers

  Scenario: Nested shelf heading opens an explicit search
    Given I am signed in with a nested bookshelf that has publications
    When I click that nested shelf title on home
    Then I go to /search?bookshelf={d} for that shelf
    And targeted publications appear as result cards
    And I do not fan out to other tag searches
