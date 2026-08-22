@mvp
Feature: Comments, threads, and ratings
  As a reader
  I want comment threads on an edition or wiki, and star ratings on an edition
  So that the page behaves like a book page

  Scenario: Edition threads nest replies
    Given an edition has a kind 1111 comment targeted at that 30040, with a reply
    When I open that edition
    Then I see the root and its reply nested on the edition page before Read
    And I see each commenter's userbadge

  Scenario: Section comments sit in a folded accordion
    When I am reading a section
    Then the bottom of that section has a folded accordion for kind 1111 comments targeted at that section
    When I fold it out
    Then I see those comments nested under that section

  Scenario: Comments stay scoped
    Given I am signed in
    When I comment or reply on an edition, section, or wiki
    Then a kind 1111 NIP-22 event is targeted at that item
    And it does not appear on an unrelated work

  Scenario: Ratings use kind 34259 on an edition a-tag
    Given ratings are kind 34259 events whose a-tag is 30040:<pubkey>:<d-tag> for that edition
    And wikis are not rated
    And an edition has kind 34259 ratings
    When I open that edition
    Then I see an aggregate and each rater's userbadge on a 0-to-1 star scale
    When I am signed in and submit a rating
    Then it references that edition's a-tag
    And my previous rating of the same a-tag is replaced
    And a rating of another edition of the same i-tag is a different rating
    And a written review is a kind 1111 comment, optionally with a rating
