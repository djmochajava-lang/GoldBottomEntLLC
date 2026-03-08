// js/dashboard-widgets.js

/**
 * DashboardWidgets Module — Metric Cards, Activity Feed, Quick Actions
 * Renders the main dashboard home page widgets using DataStore data.
 * Listens for gbe:data-updated custom events to auto-refresh.
 */

const DashboardWidgets = {

  initialized: false,

  /**
   * Initialize — check if the dashboard home page is active and render widgets.
   */
  init: function () {
    // Only render when on the dashboard home page
    var metricsContainer = document.getElementById('metrics-container');
    var activityContainer = document.getElementById('activity-container');
    var actionsContainer = document.getElementById('quick-actions-container');

    if (!metricsContainer && !activityContainer && !actionsContainer) {
      return;
    }

    if (metricsContainer) this.renderMetrics('metrics-container');
    if (activityContainer) this.renderActivityFeed('activity-container');
    if (actionsContainer) this.renderQuickActions('quick-actions-container');

    // Attach data-updated listener (only once)
    if (!this.initialized) {
      document.addEventListener('gbe:data-updated', function () {
        DashboardWidgets.refresh();
      });
      this.initialized = true;
    }

    console.log('DashboardWidgets initialized');
  },

  /**
   * Render 6 metric cards in a .metrics-grid container.
   * @param {string} containerId
   */
  renderMetrics: function (containerId) {
    var container = document.getElementById(containerId);
    if (!container) return;

    var metrics = {};
    if (typeof DataStore !== 'undefined') {
      metrics = DataStore.getMetrics();
    }

    var cards = [
      {
        label: 'Roster Count',
        value: metrics.rosterCount || 0,
        icon: 'fa-solid fa-users',
        color: 'gold',
        format: 'number'
      },
      {
        label: 'Active Contracts',
        value: metrics.activeContracts || 0,
        icon: 'fa-solid fa-file-signature',
        color: 'info',
        format: 'number'
      },
      {
        label: 'Revenue YTD',
        value: metrics.revenueYTD || 0,
        icon: 'fa-solid fa-chart-line',
        color: 'success',
        format: 'currency'
      },
      {
        label: 'Upcoming Events',
        value: metrics.upcomingEvents || 0,
        icon: 'fa-solid fa-calendar-days',
        color: 'warning',
        format: 'number'
      },
      {
        label: 'Merch Sales',
        value: metrics.merchSales || 0,
        icon: 'fa-solid fa-bag-shopping',
        color: 'gold',
        format: 'currency'
      },
      {
        label: 'Outstanding Invoices',
        value: metrics.outstandingInvoices || 0,
        icon: 'fa-solid fa-file-invoice-dollar',
        color: 'danger',
        format: 'currency'
      }
    ];

    var html = '<div class="metrics-grid">';

    for (var i = 0; i < cards.length; i++) {
      var card = cards[i];
      var displayValue = card.format === 'currency'
        ? this._formatCurrency(card.value)
        : String(card.value);

      html += '<div class="metric-card glass-card">';
      html += '  <div class="metric-icon metric-icon--' + card.color + '">';
      html += '    <i class="' + card.icon + '"></i>';
      html += '  </div>';
      html += '  <div class="metric-body">';
      html += '    <div class="metric-value">' + displayValue + '</div>';
      html += '    <div class="metric-label">' + card.label + '</div>';
      html += '  </div>';
      html += '</div>';
    }

    html += '</div>';
    container.innerHTML = html;
  },

  /**
   * Render recent activity feed from DataStore.
   * Shows max 10 items with colored icons by action type.
   * @param {string} containerId
   */
  renderActivityFeed: function (containerId) {
    var container = document.getElementById(containerId);
    if (!container) return;

    var activities = [];
    if (typeof DataStore !== 'undefined') {
      activities = DataStore.getActivity(10);
    }

    if (activities.length === 0) {
      container.innerHTML =
        '<div class="empty-state">' +
        '  <div class="empty-state-icon"><i class="fa-solid fa-clock-rotate-left"></i></div>' +
        '  <p class="empty-state-text">No recent activity.</p>' +
        '</div>';
      return;
    }

    var actionColors = {
      create: 'success',
      update: 'info',
      delete: 'danger'
    };

    var actionIcons = {
      create: 'fa-solid fa-plus',
      update: 'fa-solid fa-pen',
      delete: 'fa-solid fa-trash'
    };

    var actionVerbs = {
      create: 'Created',
      update: 'Updated',
      delete: 'Deleted'
    };

    var html = '<div class="activity-feed">';

    for (var i = 0; i < activities.length; i++) {
      var activity = activities[i];
      var color = actionColors[activity.action] || 'info';
      var icon = actionIcons[activity.action] || 'fa-solid fa-circle-info';
      var verb = actionVerbs[activity.action] || activity.action;
      var timeText = this._timeAgo(activity.timestamp);

      html += '<div class="activity-item">';
      html += '  <div class="activity-icon activity-icon--' + color + '">';
      html += '    <i class="' + icon + '"></i>';
      html += '  </div>';
      html += '  <div class="activity-body">';
      html += '    <span class="activity-text">';
      html += '      <strong>' + verb + '</strong> ' + this._escapeHtml(activity.entityType);
      html += '      &mdash; ' + this._escapeHtml(activity.entityName);
      html += '    </span>';
      html += '    <span class="activity-time">' + timeText + '</span>';
      html += '  </div>';
      html += '</div>';
    }

    html += '</div>';
    container.innerHTML = html;
  },

  /**
   * Render a grid of quick action buttons.
   * Each button navigates to the corresponding dashboard section.
   * @param {string} containerId
   */
  renderQuickActions: function (containerId) {
    var container = document.getElementById(containerId);
    if (!container) return;

    var actions = [
      { label: 'Add Talent', icon: 'fa-solid fa-user-plus', target: '#dashboard-roster' },
      { label: 'New Contract', icon: 'fa-solid fa-file-circle-plus', target: '#dashboard-contracts' },
      { label: 'Log Revenue', icon: 'fa-solid fa-dollar-sign', target: '#dashboard-finances' },
      { label: 'Add Event', icon: 'fa-solid fa-calendar-plus', target: '#dashboard-calendar' },
      { label: 'New Booking', icon: 'fa-solid fa-ticket', target: '#dashboard-booking' },
      { label: 'Register IP', icon: 'fa-solid fa-copyright', target: '#dashboard-ip' }
    ];

    var html = '<div class="quick-actions-grid">';

    for (var i = 0; i < actions.length; i++) {
      var action = actions[i];
      html += '<button class="quick-action-btn" data-navigate="' + action.target + '">';
      html += '  <i class="' + action.icon + '"></i>';
      html += '  <span>' + action.label + '</span>';
      html += '</button>';
    }

    html += '</div>';
    container.innerHTML = html;

    // Bind click handlers for navigation
    var buttons = container.querySelectorAll('.quick-action-btn');
    for (var b = 0; b < buttons.length; b++) {
      buttons[b].addEventListener('click', function () {
        var target = this.getAttribute('data-navigate');
        if (typeof Router !== 'undefined') {
          var pageName = target.replace('#', '');
          Router.navigateTo(pageName);
        } else {
          window.location.hash = target;
        }
      });
    }
  },

  /**
   * Refresh all widgets with fresh data from DataStore.
   */
  refresh: function () {
    var metricsContainer = document.getElementById('metrics-container');
    var activityContainer = document.getElementById('activity-container');
    var actionsContainer = document.getElementById('quick-actions-container');

    if (metricsContainer) this.renderMetrics('metrics-container');
    if (activityContainer) this.renderActivityFeed('activity-container');
    if (actionsContainer) this.renderQuickActions('quick-actions-container');
  },

  // ============================================================
  // HELPERS
  // ============================================================

  /**
   * Format a number as currency (USD).
   * Uses Utils.formatCurrency if available, otherwise a simple fallback.
   * @param {number} amount
   * @returns {string}
   */
  _formatCurrency: function (amount) {
    if (typeof Utils !== 'undefined' && Utils.formatCurrency) {
      return Utils.formatCurrency(amount);
    }
    var num = parseFloat(amount) || 0;
    return '$' + num.toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  },

  /**
   * Compute a human-readable "time ago" string from an ISO timestamp.
   * Uses Utils.timeAgo if available.
   * @param {string} timestamp - ISO 8601 string
   * @returns {string}
   */
  _timeAgo: function (timestamp) {
    if (typeof Utils !== 'undefined' && Utils.timeAgo) {
      return Utils.timeAgo(timestamp);
    }

    var now = new Date();
    var then = new Date(timestamp);
    var diffMs = now - then;
    var diffSec = Math.floor(diffMs / 1000);
    var diffMin = Math.floor(diffSec / 60);
    var diffHr = Math.floor(diffMin / 60);
    var diffDay = Math.floor(diffHr / 24);

    if (diffSec < 60) return 'Just now';
    if (diffMin < 60) return diffMin + 'm ago';
    if (diffHr < 24) return diffHr + 'h ago';
    if (diffDay < 30) return diffDay + 'd ago';
    if (diffDay < 365) return Math.floor(diffDay / 30) + 'mo ago';
    return Math.floor(diffDay / 365) + 'y ago';
  },

  /**
   * Escape HTML special characters.
   * @param {string} str
   * @returns {string}
   */
  _escapeHtml: function (str) {
    if (!str) return '';
    var div = document.createElement('div');
    div.appendChild(document.createTextNode(str));
    return div.innerHTML;
  }
};

// Auto-initialize
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', function () { if (DashboardWidgets.init) DashboardWidgets.init(); });
} else {
  if (DashboardWidgets.init) DashboardWidgets.init();
}

if (typeof module !== 'undefined' && module.exports) module.exports = DashboardWidgets;
