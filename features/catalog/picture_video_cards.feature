@mvp
Feature: Picture and video cards
  As a reader of illustrated books
  I want kind 20 and 21 to look like a gallery or a video
  So that plates and clips are not dumped onto the generic card

  Background:
    Given kind 20 is a NIP-68 picture event and kind 21 is a NIP-71 video event
    And these dedicated cards are used in embeds, search, reader children, and threads

  Scenario: Kind 20 is a picture gallery
    Given an embedded kind 20 with three distinct images
    Then I see a dedicated picture card with all three
    And I do not see the generic card instead

  Scenario: Kind 21 is a video card
    Given an embedded kind 21
    Then I see a dedicated video card with a player
    And a poster, title, or leftover caption is shown when available
