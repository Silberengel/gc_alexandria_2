Feature: NIP-37 draft wraps
  Encrypted document drafts are stored as kind 31234 on the author's kind 10013
  private relays, with kind 1234 checkpoints for revision history.

  Scenario: Save to Draft on document kinds
    Given I am signed in with a NIP-44 capable signer
    And I am composing a document kind (30040, 30818, 30817, 30023, 1, or 30041)
    When I have no kind 10013 private relay list
    Then Save to Draft opens a modal to create one with my relays or public fallback relays
    And the public fallback button lists the concrete PUBLIC_BROADCAST_RELAYS URLs

  Scenario: Encrypted drafts appear in the Drafts list
    Given I have published kind 31234 wraps to my private relays
    When I open the compose Drafts list
    Then each encrypted draft shows a lock badge
    And Restore decrypts the wrap into the compose form
    And Delete publishes a blank-content 31234 for that d-tag

  Scenario: Checkpoints in the advanced editor
    Given I have saved a draft wrap more than once
    When I open the advanced markup editor with that draft active
    Then History lists kind 1234 checkpoints with pairwise content diffs
