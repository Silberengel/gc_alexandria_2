@mvp
Feature: Publication AsciiDoc splitter (30040 / 30041)
  As a publisher
  I want to paste one AsciiDoc manuscript and split it into a publication index
  So that each section stays under 50 KiB and publishes bottom-up with verify

  Background:
    Given I am composing kind 30040
    And Sections mode can be Link sections or Split from AsciiDoc
    And the Title field owns the publication title (no lone = heading in the body)
    And orphan body under a branch heading becomes a Preamble child section (nothing discarded)

  Scenario: Orphan chapter intro becomes Preamble
    Given a == chapter with intro text before its first === child
    When the manuscript is parsed
    Then a Preamble section holds that intro
    And the chapter index lists Preamble before the later subsections

  Scenario: Structure tree reflects the eventual events
    Given I open the AsciiDoc splitter with == chapters
    Then the publication tree shows a root 30040 and a 30041 per chapter
    And oversize leaves show ghost Section 1…N rows before Ideal split

  Scenario: Ideal split inserts Section N under oversize chapters
    Given a chapter body larger than 50 KiB
    When I apply Ideal split
    Then Section 1…N headings are inserted at the next level
    And every leaf body is at most 50 KiB
    And index depth rises when those child headings must be events

  Scenario: Publish order is bottom-up with verify
    Given a valid split tree
    When I publish
    Then all 30041 sections publish first
    And nested 30040 indexes publish deepest-first
    And the root 30040 publishes last with a-tags to its children
    And each event is verified on at least one relay with republish on miss
    And progress stays visible in the splitter during publish and verify

  Scenario: Retry failed after partial relay miss
    Given publish finished with some events missing on relays
    When I choose Retry failed
    Then only the missing signed events are republished and re-verified
    And the missing d-tag list updates until all are confirmed

  Scenario: Named manuscripts persist in Drafts via IndexedDB
    Given I paste a multi-MB AsciiDoc manuscript in split mode
    Then the body is stored in IndexedDB (not sessionStorage)
    And Drafts lists a book-icon row named from the Title field
    And closing the browser tab and returning still offers that manuscript
    And opening the row restores split mode, AsciiDoc, title, and d-tag
    And Delete removes only that local manuscript
    And a successful publish deletes the linked manuscript
    And PWA / app updates migrate the manuscript DB schema without dropping bodies
    And a transient read error does not delete the manuscript
