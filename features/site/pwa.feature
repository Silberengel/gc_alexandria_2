@mvp
Feature: Progressive web app
  As a reader on a phone or laptop
  I want to install Alexandria and reopen it quickly
  So that the library feels like an app even when the network is slow

  Scenario: Installable web app
    Given the site ships a web app manifest and icons
    And a service worker precaches the shell (HTML, JS, CSS, and app icons)
    When I open the site over HTTPS in a supporting browser
    Then I can install it as a standalone app
    And revisits load the shell from the service worker cache
    And the existing client event cache still serves publications and covers offline
    And when a newer service worker is waiting, the landing page shows an update banner
    And choosing OK on that banner activates the update and reloads the app
