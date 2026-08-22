@mvp
Feature: Highlights
  As a reader
  I want NIP-84 highlights listed and marked in the text
  So that quotes on a section are visible here

  Scenario: Public highlights are listed and marked
    Given a section has public kind 9802 highlights whose a-tag is that section's kind:pubkey:d-tag
    When I open that edition
    Then I see those highlights with the quoted passage and the highlighter's userbadge
    And I see the same highlights marked in the section body once I read
    And I do not need an account to see public highlights
    And a 9802 that only has an i-tag source is not treated as a highlight of this edition

  Scenario: Signed-in reader creates a highlight
    Given I am signed in
    When I select text in a section and save a highlight
    Then it is stored as a kind 9802 NIP-84 highlight whose a-tag is that section's kind:pubkey:d-tag
    And it is not stored with an i-tag as the publication source
    And it appears in the highlight list after reload
