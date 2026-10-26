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
    Then each encrypted draft shows a lock badge in a file-explorer list
    And each row shows name, d-tag, kind, and modified time
    And a local autosave that matches that wrap (same d or body) is not listed alongside it
    And opening a row restores that draft into the compose form
    And Delete publishes a blank-content 31234 for that d-tag

  Scenario: Kind switch starts blank
    Given I am on Compose with a document kind selected
    When I switch the kind picker to another document kind that has a tab autosave
    Then the form is blank (catalog defaults only)
    And I must use Drafts → Restore to load a tab autosave or encrypted wrap

  Scenario: Checkpoints in the advanced editor
    Given I have saved a draft wrap more than once
    When I open the advanced markup editor with that draft active
    Then History lists kind 1234 checkpoints with pairwise content diffs
