@mvp
Feature: Generic event card
  As a visitor
  I want every event to render as a card
  So that search hits, comments, and embeds never become a blank hole

  Background:
    Given dedicated cards win for publications, wiki and spec pages, highlights, comments, kind 1 notes, kind 20, and kind 21
    And one shared generic card is the fallback everywhere else
    And the same card pipeline is used in search, threads, the reader, wiki bodies, and nostr embeds

  Scenario: Unknown or empty events still paint a card
    When I see an event with no dedicated renderer
    Then I see a generic card, not a blank gap or raw JSON
    And published by is a userbadge
    And title (≤100 chars) and body (≤250 chars) are plain text with markup stripped when present
    And subjects, source, and media are shown when present
    And if there is nothing to show I still see published by and a no-preview placeholder

  Scenario: Media is never shown twice
    Given an event has the same file in content, an image tag, and imeta
    When any card is shown for that event
    Then that picture, audio, or video is rendered once
    And a different imeta file is still shown
    And content is stripped of URLs already shown as media

  Scenario: Bare image URLs render inline
    Given a section, wiki, note, or comment body contains a bare https image URL (png/jpeg/gif/webp/avif/svg)
    When that body is rendered
    Then I see an inline image for that URL, not only linkified text
    And URLs already used in image:: or markdown image markup are left alone

  Scenario: nostr: prefixes become embeds or compact userbadges
    Given a comment, wiki body, or section contains a nostr: prefix immediately before a valid bech32 npub, nprofile, naddr, nevent, or note
    When the target is an npub or nprofile
    Then I see a compact userbadge with no picture
    And its label is that pubkey's kind 0 handle, else a shortened npub
    When the target is an naddr, nevent, or note and that event is resolved
    Then I see its dedicated card or the generic card
    When it cannot be resolved
    Then I see a placeholder and the host page still renders
    And nostr:nsec and invalid bech32 are not rendered as embeds or links
