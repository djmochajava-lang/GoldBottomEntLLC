// js/calendar.js

/**
 * Calendar Module — Month-View Calendar Renderer
 * Displays a navigable month grid with event dots, day click details,
 * and an upcoming events list. Integrates with DataStore for event data.
 * Listens for gbe:data-updated custom events to auto-refresh.
 */

const Calendar = {

  currentYear: new Date().getFullYear(),
  currentMonth: new Date().getMonth(),
  selectedDay: null,
  initialized: false,

  /**
   * Day-of-week header labels
   */
  dayNames: ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'],

  /**
   * Month name labels
   */
  monthNames: [
    'January', 'February', 'March', 'April', 'May', 'June',
    'July', 'August', 'September', 'October', 'November', 'December'
  ],

  /**
   * Event type color mapping
   */
  typeColors: {
    gig: '#d4a017',
    meeting: '#58a6ff',
    studio: '#bc8cff',
    deadline: '#f85149',
    travel: '#3fb950'
  },

  /**
   * Initialize — find #calendar-container and render current month.
   */
  init: function () {
    var container = document.getElementById('calendar-container');
    if (!container) return;

    this.render('calendar-container');

    // Render upcoming events sidebar if container exists
    var upcomingContainer = document.getElementById('upcoming-events-container');
    if (upcomingContainer) {
      this.renderUpcoming('upcoming-events-container');
    }

    // Attach data-updated listener (only once)
    if (!this.initialized) {
      var self = this;
      document.addEventListener('gbe:data-updated', function () {
        self.refresh();
      });
      this.initialized = true;
    }

    console.log('Calendar initialized');
  },

  /**
   * Render the full calendar UI into the specified container.
   * @param {string} containerId
   */
  render: function (containerId) {
    var container = document.getElementById(containerId);
    if (!container) return;

    var html = '';

    // Calendar header with navigation
    html += '<div class="calendar-header">';
    html += '  <button class="calendar-nav-btn" id="calendar-prev" title="Previous month">';
    html += '    <i class="fa-solid fa-chevron-left"></i>';
    html += '  </button>';
    html += '  <h3 class="calendar-title">';
    html += '    ' + this.monthNames[this.currentMonth] + ' ' + this.currentYear;
    html += '  </h3>';
    html += '  <button class="calendar-nav-btn" id="calendar-next" title="Next month">';
    html += '    <i class="fa-solid fa-chevron-right"></i>';
    html += '  </button>';
    html += '</div>';

    // Day-of-week header row
    html += '<div class="calendar-grid">';
    html += '<div class="calendar-weekdays">';
    for (var d = 0; d < this.dayNames.length; d++) {
      html += '<div class="calendar-weekday">' + this.dayNames[d] + '</div>';
    }
    html += '</div>';

    // Calendar day cells
    html += this._renderDayGrid();
    html += '</div>';

    // Event list below calendar (for selected day)
    html += '<div id="calendar-event-list" class="calendar-event-list"></div>';

    container.innerHTML = html;

    // Bind navigation events
    this._bindEvents(container);

    // If a day was selected, show its events
    if (this.selectedDay !== null) {
      this._showDayEvents(this.selectedDay);
    }
  },

  /**
   * Render the 6x7 grid of day cells for the current month.
   * @returns {string} HTML string
   */
  _renderDayGrid: function () {
    var year = this.currentYear;
    var month = this.currentMonth;

    var firstDay = new Date(year, month, 1).getDay(); // 0=Sun
    var daysInMonth = new Date(year, month + 1, 0).getDate();
    var daysInPrevMonth = new Date(year, month, 0).getDate();

    var today = new Date();
    var isCurrentMonth = (today.getFullYear() === year && today.getMonth() === month);
    var todayDate = today.getDate();

    // Get events for the month
    var monthEvents = this.getEventsForMonth(year, month);

    var html = '<div class="calendar-days">';
    var cellCount = 0;
    var totalCells = 42; // 6 rows x 7 columns

    // Previous month trailing days
    for (var p = firstDay - 1; p >= 0; p--) {
      var prevDay = daysInPrevMonth - p;
      html += '<div class="calendar-day calendar-day--dimmed">';
      html += '  <span class="calendar-day-number">' + prevDay + '</span>';
      html += '</div>';
      cellCount++;
    }

    // Current month days
    for (var day = 1; day <= daysInMonth; day++) {
      var classes = 'calendar-day';
      var isToday = isCurrentMonth && day === todayDate;
      var isSelected = this.selectedDay === day;

      if (isToday) classes += ' calendar-day--today';
      if (isSelected) classes += ' calendar-day--selected';

      // Check for events on this day
      var dayEvents = this._filterEventsByDay(monthEvents, day);

      html += '<div class="' + classes + '" data-day="' + day + '">';
      html += '  <span class="calendar-day-number">' + day + '</span>';

      // Event dots
      if (dayEvents.length > 0) {
        html += '  <div class="calendar-day-dots">';
        // Show up to 3 dots
        var dotCount = Math.min(dayEvents.length, 3);
        for (var e = 0; e < dotCount; e++) {
          var eventType = dayEvents[e].type || 'gig';
          var dotColor = this.typeColors[eventType] || '#d4a017';
          html += '    <span class="calendar-dot" style="background-color: ' + dotColor + ';" title="' + this._escapeHtml(dayEvents[e].title) + '"></span>';
        }
        if (dayEvents.length > 3) {
          html += '    <span class="calendar-dot-more">+' + (dayEvents.length - 3) + '</span>';
        }
        html += '  </div>';
      }

      html += '</div>';
      cellCount++;
    }

    // Next month leading days
    var nextDay = 1;
    while (cellCount < totalCells) {
      html += '<div class="calendar-day calendar-day--dimmed">';
      html += '  <span class="calendar-day-number">' + nextDay + '</span>';
      html += '</div>';
      nextDay++;
      cellCount++;
    }

    html += '</div>';
    return html;
  },

  /**
   * Bind click events for navigation arrows and day cells.
   * @param {HTMLElement} container
   */
  _bindEvents: function (container) {
    var self = this;

    // Previous month button
    var prevBtn = container.querySelector('#calendar-prev');
    if (prevBtn) {
      prevBtn.addEventListener('click', function () {
        self.navigateMonth(-1);
      });
    }

    // Next month button
    var nextBtn = container.querySelector('#calendar-next');
    if (nextBtn) {
      nextBtn.addEventListener('click', function () {
        self.navigateMonth(1);
      });
    }

    // Day cell clicks
    var dayCells = container.querySelectorAll('.calendar-day:not(.calendar-day--dimmed)');
    for (var i = 0; i < dayCells.length; i++) {
      dayCells[i].addEventListener('click', function () {
        var day = parseInt(this.getAttribute('data-day'), 10);
        if (!isNaN(day)) {
          self.selectedDay = day;
          self._highlightSelectedDay(day);
          self._showDayEvents(day);
        }
      });
    }
  },

  /**
   * Navigate forward or backward by offset months and re-render.
   * @param {number} offset - +1 or -1
   */
  navigateMonth: function (offset) {
    this.currentMonth += offset;

    if (this.currentMonth > 11) {
      this.currentMonth = 0;
      this.currentYear++;
    } else if (this.currentMonth < 0) {
      this.currentMonth = 11;
      this.currentYear--;
    }

    this.selectedDay = null;
    this.render('calendar-container');
  },

  /**
   * Get all events for a given month from DataStore.
   * @param {number} year
   * @param {number} month - 0-indexed
   * @returns {Array}
   */
  getEventsForMonth: function (year, month) {
    if (typeof DataStore === 'undefined') return [];

    var events = DataStore.getEvents();
    var prefix = year + '-' + String(month + 1).padStart(2, '0');

    return events.filter(function (evt) {
      return evt.date && evt.date.substring(0, 7) === prefix;
    });
  },

  /**
   * Get events for a specific day.
   * @param {number} year
   * @param {number} month - 0-indexed
   * @param {number} day
   * @returns {Array}
   */
  getEventsForDay: function (year, month, day) {
    var monthEvents = this.getEventsForMonth(year, month);
    return this._filterEventsByDay(monthEvents, day);
  },

  /**
   * Filter a list of month events by day number.
   * @param {Array} events
   * @param {number} day
   * @returns {Array}
   */
  _filterEventsByDay: function (events, day) {
    var dayStr = String(day).padStart(2, '0');
    var year = this.currentYear;
    var month = this.currentMonth;
    var datePrefix = year + '-' + String(month + 1).padStart(2, '0') + '-' + dayStr;

    return events.filter(function (evt) {
      return evt.date && evt.date.substring(0, 10) === datePrefix;
    });
  },

  /**
   * Highlight the selected day in the calendar grid.
   * @param {number} day
   */
  _highlightSelectedDay: function (day) {
    // Remove previous selection
    var allDays = document.querySelectorAll('.calendar-day--selected');
    for (var i = 0; i < allDays.length; i++) {
      allDays[i].classList.remove('calendar-day--selected');
    }

    // Add selection to clicked day
    var dayCells = document.querySelectorAll('.calendar-day[data-day="' + day + '"]');
    for (var d = 0; d < dayCells.length; d++) {
      dayCells[d].classList.add('calendar-day--selected');
    }
  },

  /**
   * Show events for a selected day in the event list area below the calendar.
   * @param {number} day
   */
  _showDayEvents: function (day) {
    var events = this.getEventsForDay(this.currentYear, this.currentMonth, day);
    var listContainer = document.getElementById('calendar-event-list');
    if (!listContainer) return;

    if (events.length === 0) {
      var dateStr = this.monthNames[this.currentMonth] + ' ' + day + ', ' + this.currentYear;
      listContainer.innerHTML =
        '<div class="calendar-event-list-header">' +
        '  <h4>' + dateStr + '</h4>' +
        '</div>' +
        '<p class="calendar-no-events">No events on this day.</p>';
      return;
    }

    this.renderEventList(events, listContainer, day);
  },

  /**
   * Render a list of events into a container.
   * Each event: colored dot + time + title + type badge.
   * @param {Array} events
   * @param {HTMLElement} [container] - Optional container; if omitted, returns HTML
   * @param {number} [day] - Optional day number for header
   */
  renderEventList: function (events, container, day) {
    var html = '';

    if (day !== undefined) {
      var dateStr = this.monthNames[this.currentMonth] + ' ' + day + ', ' + this.currentYear;
      html += '<div class="calendar-event-list-header">';
      html += '  <h4>' + dateStr + '</h4>';
      html += '</div>';
    }

    html += '<div class="calendar-events">';

    for (var i = 0; i < events.length; i++) {
      var evt = events[i];
      var type = evt.type || 'gig';
      var color = this.typeColors[type] || '#d4a017';
      var time = this._formatEventTime(evt.date);

      html += '<div class="calendar-event-item">';
      html += '  <span class="calendar-event-dot" style="background-color: ' + color + ';"></span>';
      html += '  <span class="calendar-event-time">' + time + '</span>';
      html += '  <span class="calendar-event-title">' + this._escapeHtml(evt.title) + '</span>';
      html += '  <span class="calendar-event-badge calendar-event-badge--' + type + '">' + type + '</span>';
      html += '</div>';
    }

    html += '</div>';

    if (container) {
      container.innerHTML = html;
    }

    return html;
  },

  /**
   * Render upcoming events as a compact list (for dashboard sidebar).
   * Shows the next 5 upcoming events.
   * @param {string} containerId
   */
  renderUpcoming: function (containerId) {
    var container = document.getElementById(containerId);
    if (!container) return;

    var events = [];
    if (typeof DataStore !== 'undefined') {
      events = DataStore.getUpcomingEvents(5);
    }

    if (events.length === 0) {
      container.innerHTML =
        '<div class="empty-state">' +
        '  <div class="empty-state-icon"><i class="fa-solid fa-calendar-xmark"></i></div>' +
        '  <p class="empty-state-text">No upcoming events.</p>' +
        '</div>';
      return;
    }

    var html = '<div class="upcoming-events-list">';

    for (var i = 0; i < events.length; i++) {
      var evt = events[i];
      var type = evt.type || 'gig';
      var color = this.typeColors[type] || '#d4a017';
      var dateDisplay = this._formatUpcomingDate(evt.date);
      var timeDisplay = this._formatEventTime(evt.date);

      html += '<div class="upcoming-event-item">';
      html += '  <span class="calendar-event-dot" style="background-color: ' + color + ';"></span>';
      html += '  <div class="upcoming-event-info">';
      html += '    <span class="upcoming-event-title">' + this._escapeHtml(evt.title) + '</span>';
      html += '    <span class="upcoming-event-date">' + dateDisplay + ' &middot; ' + timeDisplay + '</span>';
      html += '  </div>';
      html += '  <span class="calendar-event-badge calendar-event-badge--' + type + '">' + type + '</span>';
      html += '</div>';
    }

    html += '</div>';
    container.innerHTML = html;
  },

  /**
   * Refresh the calendar and upcoming events with fresh data.
   */
  refresh: function () {
    var calendarContainer = document.getElementById('calendar-container');
    if (calendarContainer) {
      this.render('calendar-container');
    }

    var upcomingContainer = document.getElementById('upcoming-events-container');
    if (upcomingContainer) {
      this.renderUpcoming('upcoming-events-container');
    }
  },

  // ============================================================
  // HELPERS
  // ============================================================

  /**
   * Format an ISO date string to a time string (e.g. "8:00 PM").
   * @param {string} dateStr
   * @returns {string}
   */
  _formatEventTime: function (dateStr) {
    if (!dateStr) return '';
    var date = new Date(dateStr);
    var hours = date.getHours();
    var minutes = date.getMinutes();
    var ampm = hours >= 12 ? 'PM' : 'AM';

    hours = hours % 12;
    if (hours === 0) hours = 12;
    var minStr = minutes < 10 ? '0' + minutes : String(minutes);

    return hours + ':' + minStr + ' ' + ampm;
  },

  /**
   * Format an ISO date for the upcoming events sidebar (e.g. "Jun 15").
   * Uses Utils.formatDate if available.
   * @param {string} dateStr
   * @returns {string}
   */
  _formatUpcomingDate: function (dateStr) {
    if (typeof Utils !== 'undefined' && Utils.formatDate) {
      return Utils.formatDate(dateStr);
    }

    if (!dateStr) return '';
    var date = new Date(dateStr);
    var shortMonths = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
                       'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    return shortMonths[date.getMonth()] + ' ' + date.getDate();
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
  document.addEventListener('DOMContentLoaded', function () { if (Calendar.init) Calendar.init(); });
} else {
  if (Calendar.init) Calendar.init();
}

if (typeof module !== 'undefined' && module.exports) module.exports = Calendar;
