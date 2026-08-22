@mvp
Feature: Profile page
  As a visitor
  I want a page for an npub
  So that badges open a person, not a search dump

  Background:
    Given /p/{npub}, /p/{nprofile}, and /p/{hex-pubkey} open the same profile
    And kind 0 fields come from tags first, then JSON content, then are deduped
    And NIP-38 status is kind 30315 with d-tag general or music
    And payment targets merge kind 10133 payto tags with kind 0 lud16, lud06, w, and payto
    And payment rows are deduped by canonical type plus authority as in jumble and Imwald
    And empty produced and interacted-with lists are omitted

  Scenario: Userbadges open /p/
    When I see a published-by, comment, highlight, rating, or signed-in badge
    Then it is a userbadge using that pubkey's kind 0 picture and display name when they exist
    And clicking it opens /p/ for that npub
    And a nostr: npub or nprofile in content is the compact userbadge in generic_card, with no picture
    And clicking that compact badge also opens /p/

  Scenario: /p/ lists profile, status, and payments
    When I open /p/ for a pubkey that has a kind 0
    Then I see picture, display name, name, about, website, NIP-05, and banner when present
    And a field in both tags and JSON is shown once, with the tag winning
    And extra JSON keys still appear
    And an unexpired kind 30315 general or music status is shown with its r-tag link
    And payment rows from kind 0 then kind 10133 are shown once per type plus authority
    When that pubkey has no kind 0
    Then I still see the pubkey and omit missing fields

  Scenario: /p/ lists what they produced and touched
    Given that pubkey signed a 30040, 30818, or 30817
    And another such event credits them with a p-tag
    And they have labeled, bookmarked, highlighted, or commented on a publication or wiki, or rated a publication
    When I open /p/ for that pubkey
    Then the produced list includes the signed and p-tagged events
    And nested 30040 subindexes are omitted when they also have a top-level 30040
    And the interacted-with list shows those publications and wikis marked labeled, bookmarked, highlighted, or commented-on, and publications marked rated
    And a section or subindex interaction is shown as the parent publication when known
    And a work can appear in both lists
    And this is not a literary author-name catalog
