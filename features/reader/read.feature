@mvp
Feature: In-browser reader
  As a visitor
  I want to open a book page first, then read on demand
  So that I can see discussion without paying for the whole text up front

  Background:
    Given a readable edition with a table of contents and multiple 30041 sections
    And Mercury trees are used when GET /api/publications/:naddr/meta, /toc, and /stream exist for this naddr
    And HTTP tree events are verified before they are shown
    And Read always loads this page's 30040 (kind + pubkey + d-tag), never another pubkey's tree for the same d-tag

  Scenario: Sections wait for the button
    When I open the publication page
    Then I see the header and interaction lists
    And those lists are kind 34259 ratings for this edition's a-tag, kind 1111 threads, and kind 9802 highlights
    And I do not see section bodies
    And I see a "Read the publication" button
    And when I am signed in I can add or remove a booklist label and a bookmark for this edition
    When the header and social lists have fetched
    Then the site starts /meta, /toc, then /stream in the background
    And it does not walk a-tags while that tree exists
    When I leave before pressing the button
    Then that fetch is cancelled

  Scenario: Read shows this naddr's tree
    When I press "Read the publication"
    Then the interaction lists are replaced by the reader
    And I stay on /publication/d/{d}/p/{npub}
    And the ToC is Mercury /toc in pos order, or the document-stack fallback if this naddr has no tree
    And the first viewport is readable without the entire book
    When I click a ToC heading
    Then the reader jumps to that pos and loads that stream window if needed
    When I scroll later
    Then subsequent sections appear in order
    And missing sections show a placeholder

  Scenario: Resume position in this browser
    Given I have read into chapter 3
    When I leave and reopen the same edition on this device and press "Read the publication"
    Then I return near the last position

  Scenario: Markup is per section kind
    Given I am reading a 30040 whose children include several kinds
    Then 30041 is AsciiDoc
    And 30818 is Djot falling back to AsciiDoc
    And 30817 and 30023 are Markdown
    And 11 is Djot falling back to Markdown
    And 20 and 21 use their dedicated cards
    And any other kind uses the generic card
