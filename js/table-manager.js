// js/table-manager.js

/**
 * TableManager Module — Sortable, Filterable, Responsive Data Tables
 * Factory pattern: TableManager.create() returns a new table instance.
 * Integrates with DataStore for data, and Modal/Toast for actions.
 */

const TableManager = {

  /**
   * Create a new table instance inside a container element.
   * @param {string} containerId - The DOM id of the container element
   * @param {Object} options
   * @param {Array}  options.columns - [{key, label, sortable, render}]
   * @param {Array}  options.data - Row data array
   * @param {boolean} options.searchable - Show search bar
   * @param {Array}  options.searchKeys - Keys to search against
   * @param {string} options.emptyMessage - Message when no data
   * @param {string} options.emptyIcon - FA icon class for empty state
   * @param {Object} options.actions - {onEdit, onDelete, onView} callbacks
   * @returns {Object} Table instance with render, filter, sort, refresh methods
   */
  create(containerId, options) {
    var opts = Object.assign({
      columns: [],
      data: [],
      searchable: false,
      searchKeys: [],
      emptyMessage: 'No records found.',
      emptyIcon: 'fa-solid fa-inbox',
      actions: null
    }, options || {});

    var instance = {
      containerId: containerId,
      columns: opts.columns,
      data: opts.data.slice(),
      filteredData: opts.data.slice(),
      searchable: opts.searchable,
      searchKeys: opts.searchKeys,
      emptyMessage: opts.emptyMessage,
      emptyIcon: opts.emptyIcon,
      actions: opts.actions,
      sortColumn: null,
      sortDirection: 'asc',
      searchTerm: '',

      /**
       * Get the container element
       */
      getContainer: function () {
        return document.getElementById(this.containerId);
      },

      /**
       * Render the full table UI into the container
       */
      render: function () {
        var container = this.getContainer();
        if (!container) {
          console.error('TableManager: container #' + this.containerId + ' not found');
          return;
        }

        var html = '';

        // Search bar
        if (this.searchable) {
          html += '<div class="table-toolbar">';
          html += '  <div class="table-search">';
          html += '    <i class="fa-solid fa-magnifying-glass"></i>';
          html += '    <input type="text" class="table-search-input" placeholder="Search..." value="' + this._escapeHtml(this.searchTerm) + '">';
          html += '  </div>';
          html += '</div>';
        }

        // Table or empty state
        if (this.filteredData.length === 0) {
          html += this._renderEmptyState();
        } else {
          html += this._renderTable();
        }

        container.innerHTML = html;

        // Bind events
        this._bindEvents(container);
      },

      /**
       * Render the HTML table
       */
      _renderTable: function () {
        var self = this;
        var hasActions = this.actions && (this.actions.onEdit || this.actions.onDelete || this.actions.onView);

        var html = '<div class="table-responsive">';
        html += '<table class="data-table">';

        // thead
        html += '<thead><tr>';
        for (var c = 0; c < this.columns.length; c++) {
          var col = this.columns[c];
          var sortClass = '';
          var sortIcon = '';

          if (col.sortable) {
            sortClass = ' sortable';
            if (this.sortColumn === col.key) {
              sortClass += this.sortDirection === 'asc' ? ' sort-asc' : ' sort-desc';
              sortIcon = this.sortDirection === 'asc'
                ? ' <i class="fa-solid fa-sort-up sort-icon"></i>'
                : ' <i class="fa-solid fa-sort-down sort-icon"></i>';
            } else {
              sortIcon = ' <i class="fa-solid fa-sort sort-icon"></i>';
            }
          }

          html += '<th class="' + sortClass + '" data-sort-key="' + (col.sortable ? col.key : '') + '">';
          html += this._escapeHtml(col.label) + sortIcon;
          html += '</th>';
        }

        if (hasActions) {
          html += '<th class="actions-col">Actions</th>';
        }
        html += '</tr></thead>';

        // tbody
        html += '<tbody>';
        for (var r = 0; r < this.filteredData.length; r++) {
          var row = this.filteredData[r];
          html += '<tr data-row-id="' + (row.id || r) + '">';

          for (var ci = 0; ci < this.columns.length; ci++) {
            var column = this.columns[ci];
            var cellValue = row[column.key];
            var displayValue = '';

            if (typeof column.render === 'function') {
              displayValue = column.render(cellValue, row);
            } else {
              displayValue = cellValue !== undefined && cellValue !== null ? this._escapeHtml(String(cellValue)) : '';
            }

            html += '<td data-label="' + this._escapeHtml(column.label) + '">' + displayValue + '</td>';
          }

          if (hasActions) {
            html += '<td data-label="Actions" class="actions-cell">';
            if (this.actions.onView) {
              html += '<button class="btn btn-sm btn-ghost action-view" data-id="' + (row.id || r) + '" title="View">';
              html += '<i class="fa-solid fa-eye"></i>';
              html += '</button>';
            }
            if (this.actions.onEdit) {
              html += '<button class="btn btn-sm btn-ghost action-edit" data-id="' + (row.id || r) + '" title="Edit">';
              html += '<i class="fa-solid fa-pen-to-square"></i>';
              html += '</button>';
            }
            if (this.actions.onDelete) {
              html += '<button class="btn btn-sm btn-ghost btn-danger action-delete" data-id="' + (row.id || r) + '" title="Delete">';
              html += '<i class="fa-solid fa-trash"></i>';
              html += '</button>';
            }
            html += '</td>';
          }

          html += '</tr>';
        }
        html += '</tbody>';

        html += '</table>';
        html += '</div>';

        return html;
      },

      /**
       * Render empty state message
       */
      _renderEmptyState: function () {
        var html = '<div class="empty-state">';
        html += '  <div class="empty-state-icon"><i class="' + this.emptyIcon + '"></i></div>';
        html += '  <p class="empty-state-text">' + this._escapeHtml(this.emptyMessage) + '</p>';
        html += '</div>';
        return html;
      },

      /**
       * Bind search, sort, and action events
       */
      _bindEvents: function (container) {
        var self = this;

        // Search input
        var searchInput = container.querySelector('.table-search-input');
        if (searchInput) {
          searchInput.addEventListener('input', function () {
            self.filter(this.value);
          });
        }

        // Sort headers
        var sortHeaders = container.querySelectorAll('th.sortable');
        for (var i = 0; i < sortHeaders.length; i++) {
          sortHeaders[i].addEventListener('click', function () {
            var key = this.getAttribute('data-sort-key');
            if (!key) return;

            var direction = 'asc';
            if (self.sortColumn === key && self.sortDirection === 'asc') {
              direction = 'desc';
            }
            self.sort(key, direction);
          });
        }

        // Action buttons — View
        var viewBtns = container.querySelectorAll('.action-view');
        for (var v = 0; v < viewBtns.length; v++) {
          viewBtns[v].addEventListener('click', function () {
            var id = this.getAttribute('data-id');
            var row = self._findRowById(id);
            if (self.actions && self.actions.onView) {
              self.actions.onView(row, id);
            }
          });
        }

        // Action buttons — Edit
        var editBtns = container.querySelectorAll('.action-edit');
        for (var e = 0; e < editBtns.length; e++) {
          editBtns[e].addEventListener('click', function () {
            var id = this.getAttribute('data-id');
            var row = self._findRowById(id);
            if (self.actions && self.actions.onEdit) {
              self.actions.onEdit(row, id);
            }
          });
        }

        // Action buttons — Delete
        var deleteBtns = container.querySelectorAll('.action-delete');
        for (var d = 0; d < deleteBtns.length; d++) {
          deleteBtns[d].addEventListener('click', function () {
            var id = this.getAttribute('data-id');
            var row = self._findRowById(id);
            if (self.actions && self.actions.onDelete) {
              self.actions.onDelete(row, id);
            }
          });
        }
      },

      /**
       * Filter displayed rows by search term against searchKeys
       * @param {string} searchTerm
       */
      filter: function (searchTerm) {
        this.searchTerm = (searchTerm || '').trim();
        var term = this.searchTerm.toLowerCase();

        if (!term) {
          this.filteredData = this.data.slice();
        } else {
          var keys = this.searchKeys.length > 0
            ? this.searchKeys
            : this.columns.map(function (col) { return col.key; });

          this.filteredData = this.data.filter(function (row) {
            for (var k = 0; k < keys.length; k++) {
              var val = row[keys[k]];
              if (val !== undefined && val !== null && String(val).toLowerCase().indexOf(term) !== -1) {
                return true;
              }
            }
            return false;
          });
        }

        this.render();
      },

      /**
       * Sort data by a column key and direction
       * @param {string} columnKey
       * @param {string} direction - 'asc' or 'desc'
       */
      sort: function (columnKey, direction) {
        this.sortColumn = columnKey;
        this.sortDirection = direction || 'asc';

        var dir = this.sortDirection === 'asc' ? 1 : -1;

        this.filteredData.sort(function (a, b) {
          var valA = a[columnKey];
          var valB = b[columnKey];

          // Handle null/undefined
          if (valA == null && valB == null) return 0;
          if (valA == null) return 1;
          if (valB == null) return -1;

          // Numeric comparison
          var numA = parseFloat(valA);
          var numB = parseFloat(valB);
          if (!isNaN(numA) && !isNaN(numB)) {
            return (numA - numB) * dir;
          }

          // String comparison
          var strA = String(valA).toLowerCase();
          var strB = String(valB).toLowerCase();
          if (strA < strB) return -1 * dir;
          if (strA > strB) return 1 * dir;
          return 0;
        });

        this.render();
      },

      /**
       * Update data and re-render
       * @param {Array} newData
       */
      refresh: function (newData) {
        this.data = (newData || []).slice();
        // Re-apply current search filter
        if (this.searchTerm) {
          this.filter(this.searchTerm);
        } else {
          this.filteredData = this.data.slice();
          // Re-apply current sort
          if (this.sortColumn) {
            this.sort(this.sortColumn, this.sortDirection);
          } else {
            this.render();
          }
        }
      },

      /**
       * Find a row by its id field
       */
      _findRowById: function (id) {
        for (var i = 0; i < this.data.length; i++) {
          if (String(this.data[i].id) === String(id)) {
            return this.data[i];
          }
        }
        return null;
      },

      /**
       * Escape HTML special characters
       */
      _escapeHtml: function (str) {
        if (!str) return '';
        var div = document.createElement('div');
        div.appendChild(document.createTextNode(str));
        return div.innerHTML;
      }
    };

    // Initial render
    instance.render();

    return instance;
  }
};

// Auto-initialize (TableManager has no init method — it's a factory)
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', function () { if (TableManager.init) TableManager.init(); });
} else {
  if (TableManager.init) TableManager.init();
}

if (typeof module !== 'undefined' && module.exports) module.exports = TableManager;
