@mvp
Feature: Landing subject buttons
  As a visitor
  I want the most-used subjects on home
  So that I can start a subject search without typing a t-tag

  Background:
    Given subject buttons are distinct t-tags counted on top-level 30040s and on 30818 and 30817 pages
    And they are ordered most used first, at most 25

  Scenario: Home shows the most-used t-tags
    When I open the home page
    Then I see subject buttons
    And I do not see empty placeholder buttons
    And if the catalog has no t-tags the row is omitted

  Scenario: A subject button starts a subject search
    When I click a subject button
    Then I go to /search for that t-tag
    And it is an explicit subject search, not a typed fan-out
    And Mercury publications/search is queried with subject
    And relays are not sent #t
