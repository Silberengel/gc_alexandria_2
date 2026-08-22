@mvp
Feature: Landing publication labels
  As a visitor
  I want the most-used labels people have put on books
  So that I can open a booklist or a custom shelf like English literature without typing

  Background:
    Given a publication label is a kind 1985 NIP-32 event whose l-tag is the label and whose target is a publication
    And that includes l=booklist with namespace ugc, and any custom l such as "English literature" or "romantic fiction"
    And the target is an a-tag 30040:<pubkey>:<d-tag> or an e-tag of a 30040
    And wiki and spec pages do not count
    And buttons are distinct l values, ordered by how many distinct publications they target, most first, at most 25
    And the same l from different namespaces is one button
    And this uses the social/interaction read selector
    And a publication l-tag for language is not a landing label

  Scenario: Home shows the most-used labels
    When I open the home page
    Then I see label buttons
    And booklist appears when it ranks in those 25
    And a custom label that targets enough publications appears by its l value
    And I do not see empty placeholder buttons
    And if no publication labels exist the row is omitted

  Scenario: A label button lists books with that label
    When I click a label button
    Then I go to /search for that NIP-32 label
    And it is an explicit kind 1985 #l lookup, not a language #l search and not a typed fan-out
    And result cards are the targeted publications
