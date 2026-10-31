@mvp
Feature: Landing starter guides
  As a visitor
  I want GitCitadel Publishing recommendation shelves on Home
  So that I can start reading without knowing the full catalog

  Background:
    Given Guides are kind 30045 folder children of the GitCitadel Publishing curator’s my-book-collection
    And the curator npub is the configured GitCitadel Publishing curator
    And guide chips link to /search?bookshelf={d}&npub={curator}
    And community Labels chips stay separate and popularity-ranked
    And adding or removing folders under my-book-collection changes which Guides appear on the next Home load

  Scenario: Home shows Guides from the curator bookshelf
    Given the curator has published my-book-collection with nested folder directories
    When I open the home page as a visitor or signed-in reader
    Then I see a Guides section directly below the landing title and byline, above Reading now and the shelves
    And each nested folder under my-book-collection appears as a guide chip in membership order
    And each guide chip uses curated styling distinct from Labels chips
    And clicking a guide opens an explicit bookshelf search scoped to the curator npub

  Scenario: Missing bookshelf omits Guides
    Given the curator my-book-collection is not on the document stack
    When I open the home page
    Then the Guides section is omitted
    And Labels still work as before
