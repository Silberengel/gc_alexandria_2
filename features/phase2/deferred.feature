@phase2
Feature: Deferred library surfaces
  These must not block the first ship.

  Scenario: Literary author works page
    When I open an author-name listing (N-tag or author-tag name, not /p/)
    Then I see works attributed to that literary author

  Scenario: Subject and language browse
    When I open a subject or language facet page
    Then I see matching works

  Scenario: Reading-status shelves
    Given I am signed in
    When I add a work to want-to-read, currently-reading, or read
    Then that status is stored portably and survives reload
    And it is separate from the landing booklist and bookmark shelves

  Scenario: Cross-device resume
    Given I am signed in with a reading position
    When I open the same edition on another device with the same identity
    Then I resume near that position

  Scenario: Publish from the site
    Given I am signed in
    When I compose a publication or wiki page
    Then I can publish it to write relays
