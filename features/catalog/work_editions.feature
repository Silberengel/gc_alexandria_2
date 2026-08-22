@mvp
Feature: Works and editions
  As a visitor
  I want each naddr to be one edition, with other copies on the d-tag page
  So that Gutenberg, aggregator, and relay-published books stay distinct until I pick one

  Background:
    Given the index has a 30040 for "gutenberg:141" titled "Mansfield Park"
    And a document relay has a different 30040 with the same i-tag "gutenberg:141"

  Scenario: An naddr page is that edition
    When I open /publication/ for a 30040 naddr
    Then I see that kind 30040 only
    And I do not see other signers' editions on this page
    And the index-backed Gutenberg or aggregator copy is marked as the library copy on /publication/d/

  Scenario: Identifier groups copies on /publication/d/, not highlight rows
    Given two 30040 events share i-tag "gutenberg:141"
    Then I reach each edition from /publication/d/ as its own naddr card
    And highlight rows stay keyed by each edition's a-tag, not that i-tag

  Scenario: Network-only publications stay their own edition
    Given a 30040 with no i-tag or s-tag
    Then it has its own /publication/d/{d}/p/{npub} keyed by its coordinate
    And it is not merged into an unrelated work
