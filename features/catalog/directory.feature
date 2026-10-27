@mvp
Feature: Directory explorer (NKBIP-04)
  As a signed-in reader
  I want to create, file, and remove items in kind 30045 folders
  So that Directory works like a personal file explorer

  Background:
    Given Directory opens at /root with my-book-collection nested under it
    And folders are empty kind 30045 events linked via Android-safe a-tags
    And only d, a, and e tags are written on directory events
    And root and my-book-collection cannot be NIP-09 deleted from the explorer

  Scenario: Create a folder in the current directory
    Given I am signed in on /directory
    When I create a new folder named Notes
    Then an empty 30045 with a slugified d-tag is published
    And the current folder a-tags that nested directory
    And the new folder appears in the listing

  Scenario: Remove checked items from the current folder
    Given I am signed in on /directory inside a folder that lists publications
    When I check one or more rows and choose Remove below the checkbox column
    Then those membership a-tags are gone from the current folder
    And other children remain

  Scenario: Delete checked folders
    Given I am signed in on /directory with nested folders I own
    When I check those folder rows and choose Delete below the checkbox column
    Then the folders are unlinked from their parent
    And a kind 5 deletion is published for each folder replaceable

  Scenario: Select all via the header checkbox
    Given I am signed in on /directory with several items listed
    When I check the checkbox in the title row
    Then every row is selected
    And Remove and Delete act on the selection

  Scenario: Rename a nested folder
    Given I am signed in on /directory with a nested folder I own
    When I check that folder alone and rename it to Drafts
    Then a new 30045 is published with the same children under a new d-tag
    And the parent relinks to the renamed folder
    And a kind 5 deletion is published for the old folder replaceable

  Scenario: Add to folder from the event menu
    Given I am signed in
    When I open the … menu on a publication, wiki, or note
    Then I can choose Add to folder and pick one of my directories
    And the chosen folder gains a membership a-tag for that event
