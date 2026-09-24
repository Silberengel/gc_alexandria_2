@mvp
Feature: Landing starter guides
  As a visitor
  I want GitCitadel Publishing recommendation shelves on Home
  So that I can start reading without knowing the full catalog

  Background:
    Given starter guides are kind 30045 directories authored by the GitCitadel Publishing curator
    And the root d-tag is gc-starter-guides
    And top-level children include ancient-classics, great-books, catholic-classics, classic-novels, and black-authors
    And guide chips link to /search?bookshelf={d}&npub={curator}
    And community Labels chips stay separate and popularity-ranked

  Scenario: Home shows Guides when the curator tree is published
    Given the curator has published the starter-guides directory tree
    When I open the home page as a visitor or signed-in reader
    Then I see a Guides section above Subjects and Labels
    And genre guides appear in ancient-classics, great-books, catholic-classics, classic-novels, black-authors order
    And each guide chip uses curated styling distinct from Labels chips
    And clicking a guide opens an explicit bookshelf search scoped to the curator npub

  Scenario: Missing tree omits Guides
    Given the curator starter-guides directories are not on the document stack
    When I open the home page
    Then the Guides section is omitted
    And Labels still work as before
