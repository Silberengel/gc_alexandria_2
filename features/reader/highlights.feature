@mvp
Feature: Highlights
  As a reader
  I want NIP-84 highlights listed and marked in the text
  So that quotes on a section are visible here

  Scenario: Public highlights are marked in the text
    Given a section has public kind 9802 highlights whose a-tag is that section's kind:pubkey:d-tag
    When I open that edition and read
    Then I see those quotes highlighted in the section body
    And each highlight shows a small highlighter avatar beside the marked text
    And hovering or focusing that avatar shows their display_name or name
    And clicking the avatar opens /p/ for that pubkey
    And I do not see a separate Highlights list at the bottom
    And I do not need an account to see public highlights
    And a 9802 that only has an i-tag source is not treated as a highlight of this edition
    And highlights are queried for the edition and its section a-tags, not only the edition address

  Scenario: Signed-in reader creates a highlight
    Given I am signed in
    When I select text in a section and save a highlight
    Then it is stored as a kind 9802 NIP-84 highlight whose a-tag is that section's kind:pubkey:d-tag
    And it also carries e, p, and k tags for that section
    And it may carry a context tag with surrounding text
    And it is not stored with an i-tag as the publication source
    And the quote is marked in the section body immediately after save, with the highlighter avatar
    And I do not need to refresh the page to see that mark
    And the landing Highlights list includes that quote when I return home (merged from cache/outbox, not only Mercury)
