(function () {
  function getRelativeLabel(latestTs, nowTs) {
    const elapsedMs = Math.max(0, nowTs - latestTs);
    const minuteMs = 60 * 1000;
    const hourMs = 60 * minuteMs;
    const dayMs = 24 * hourMs;
    const weekMs = 7 * dayMs;

    if (elapsedMs < 5 * minuteMs) return '방금 전';
    if (elapsedMs < hourMs) return `${Math.max(1, Math.floor(elapsedMs / minuteMs))}분 전`;
    if (elapsedMs < dayMs) return `${Math.max(1, Math.floor(elapsedMs / hourMs))}시간 전`;
    if (elapsedMs < 2 * dayMs) return '어제';
    if (elapsedMs < weekMs) return `${Math.max(1, Math.floor(elapsedMs / dayMs))}일 전`;
    return `${Math.max(1, Math.floor(elapsedMs / weekMs))}주 전`;
  }

  function buildItemNode(item) {
    const anchor = document.createElement('a');
    anchor.href = `/content/${item.contentId}`;
    anchor.className =
      'list-group-item list-group-item-action d-flex justify-content-between align-items-center';
    anchor.setAttribute('data-comment-item', '');
    anchor.dataset.count = String(item.count || 0);
    anchor.dataset.latestTs = String(
      item.latestCommentAt ? new Date(item.latestCommentAt).getTime() : 0
    );
    anchor.dataset.title = String(item.title || '');

    const left = document.createElement('span');
    left.className = 'd-flex align-items-center gap-2';
    const title = document.createElement('span');
    title.textContent = item.title || '제목 없음';
    const badge = document.createElement('span');
    badge.className = 'badge text-bg-danger comment-new-badge d-none';
    badge.setAttribute('data-new-badge', '');

    const right = document.createElement('span');
    right.className = 'badge bg-primary rounded-pill';
    right.textContent = String(item.count || 0);

    left.appendChild(title);
    left.appendChild(badge);
    anchor.appendChild(left);
    anchor.appendChild(right);
    return anchor;
  }

  function initCommentSummaryModal() {
    const modalEl = document.getElementById('commentSummaryModal');
    if (!modalEl) return;

    const summaryList = document.getElementById('commentSummaryList');
    const sortSelect = document.getElementById('commentSummarySort');
    const freshHoursSelect = document.getElementById('commentFreshHours');
    const minCountSelect = document.getElementById('commentMinCount');
    const searchInput = document.getElementById('commentSummarySearch');
    const filteredEmpty = document.getElementById('commentSummaryFilteredEmpty');
    const emptyText = document.getElementById('commentSummaryEmpty');
    const totalCountEls = document.querySelectorAll('[data-comment-total-count]');
    const triggerEls = document.querySelectorAll('[data-comment-summary-trigger]');
    const titleEl = document.getElementById('commentSummaryModalLabel');
    let lastTrigger = null;

    if (!summaryList || !sortSelect || !freshHoursSelect || !minCountSelect || !searchInput) {
      return;
    }

    const STORAGE_KEYS = {
      sort: 'commentSummarySort',
      freshHours: 'commentSummaryFreshHours',
      minCount: 'commentSummaryMinCount',
      search: 'commentSummarySearch',
    };

    const loadPreferences = () => {
      try {
        const savedSort = localStorage.getItem(STORAGE_KEYS.sort);
        const savedFreshHours = localStorage.getItem(STORAGE_KEYS.freshHours);
        const savedMinCount = localStorage.getItem(STORAGE_KEYS.minCount);
        const savedSearch = localStorage.getItem(STORAGE_KEYS.search);
        if (savedSort) sortSelect.value = savedSort;
        if (savedFreshHours) freshHoursSelect.value = savedFreshHours;
        if (savedMinCount) minCountSelect.value = savedMinCount;
        if (savedSearch) searchInput.value = savedSearch;
      } catch (_) {}
    };

    const savePreferences = () => {
      try {
        localStorage.setItem(STORAGE_KEYS.sort, sortSelect.value);
        localStorage.setItem(STORAGE_KEYS.freshHours, freshHoursSelect.value);
        localStorage.setItem(STORAGE_KEYS.minCount, minCountSelect.value);
        localStorage.setItem(STORAGE_KEYS.search, searchInput.value.trim());
      } catch (_) {}
    };

    const renderSummary = () => {
      const sortBy = sortSelect.value;
      const freshHours = Number(freshHoursSelect.value || 24);
      const minCount = Number(minCountSelect.value || 1);
      const searchTerm = searchInput.value.trim().toLowerCase();
      const freshMs = freshHours * 60 * 60 * 1000;
      const now = Date.now();

      const items = Array.from(summaryList.querySelectorAll('[data-comment-item]'));
      items.sort((a, b) => {
        const aCount = Number(a.dataset.count || 0);
        const bCount = Number(b.dataset.count || 0);
        const aLatest = Number(a.dataset.latestTs || 0);
        const bLatest = Number(b.dataset.latestTs || 0);
        if (sortBy === 'latest') {
          if (bLatest !== aLatest) return bLatest - aLatest;
          return bCount - aCount;
        }
        if (bCount !== aCount) return bCount - aCount;
        return bLatest - aLatest;
      });

      items.forEach((item) => {
        summaryList.appendChild(item);
        const latestTs = Number(item.dataset.latestTs || 0);
        const count = Number(item.dataset.count || 0);
        const titleText = String(item.dataset.title || '').toLowerCase();
        const badge = item.querySelector('[data-new-badge]');
        const isFresh = latestTs > 0 && now - latestTs <= freshMs;
        if (badge) {
          badge.textContent = isFresh ? getRelativeLabel(latestTs, now) : '';
          badge.classList.toggle('d-none', !isFresh);
        }
        const matchesCount = count >= minCount;
        const matchesSearch = !searchTerm || titleText.includes(searchTerm);
        item.classList.toggle('d-none', !(matchesCount && matchesSearch));
      });

      const visibleCount = items.filter((item) => !item.classList.contains('d-none')).length;
      filteredEmpty.classList.toggle('d-none', visibleCount > 0);
      if (emptyText) {
        emptyText.classList.toggle('d-none', items.length > 0);
      }
    };

    const updateModalData = async () => {
      try {
        const res = await fetch('/api/comments/summary', { headers: { Accept: 'application/json' } });
        if (!res.ok) return;
        const data = await res.json();
        const list = Array.isArray(data.commentSummaryList) ? data.commentSummaryList : [];
        const total = Number(data.totalCommentCount || 0);

        summaryList.innerHTML = '';
        list.forEach((item) => summaryList.appendChild(buildItemNode(item)));

        totalCountEls.forEach((el) => {
          el.textContent = String(total);
        });
        if (titleEl) {
          titleEl.textContent = `댓글 현황 (${total})`;
        }
        renderSummary();
      } catch (_) {}
    };

    triggerEls.forEach((trigger) => {
      trigger.addEventListener('click', () => {
        lastTrigger = trigger;
      });
    });

    sortSelect.addEventListener('change', () => {
      savePreferences();
      renderSummary();
    });
    freshHoursSelect.addEventListener('change', () => {
      savePreferences();
      renderSummary();
    });
    minCountSelect.addEventListener('change', () => {
      savePreferences();
      renderSummary();
    });
    searchInput.addEventListener('input', () => {
      savePreferences();
      renderSummary();
    });

    modalEl.addEventListener('shown.bs.modal', () => {
      searchInput.focus();
      updateModalData();
    });
    modalEl.addEventListener('hidden.bs.modal', () => {
      if (lastTrigger && typeof lastTrigger.focus === 'function') {
        lastTrigger.focus();
      }
    });

    loadPreferences();
    renderSummary();
  }

  window.addEventListener('DOMContentLoaded', initCommentSummaryModal);
})();
