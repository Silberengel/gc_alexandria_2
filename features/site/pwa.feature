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
    And when a newer deploy is detected (waiting service worker or /version.json build stamp), a site-wide update banner appears within about 30 seconds
    And choosing OK on that banner activates any waiting worker, unregisters service workers, clears Cache Storage, and hard-navigates with a cache-busting URL
    And document navigations are not served from a precached index.html (so deploys are not sticky)
