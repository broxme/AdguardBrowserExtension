/**
 * This file is part of Adguard Browser Extension (https://github.com/AdguardTeam/AdguardBrowserExtension).
 *
 * Adguard Browser Extension is free software: you can redistribute it and/or modify
 * it under the terms of the GNU Lesser General Public License as published by
 * the Free Software Foundation, either version 3 of the License, or
 * (at your option) any later version.
 *
 * Adguard Browser Extension is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
 * GNU Lesser General Public License for more details.
 *
 * You should have received a copy of the GNU Lesser General Public License
 * along with Adguard Browser Extension.  If not, see <http://www.gnu.org/licenses/>.
 */
var backgroundPage = ext.backgroundPage.getWindow();
var antiBannerService;
var adguardApplication;
var UI;
var filteringLog;
var EventNotifier;
var LogEvents;
var UrlUtils;
var StringUtils;
var AntiBannerFiltersId;
var Utils;

var FilterRule;
var UrlFilterRule;

var PageController = function () {
	this.requestWizard = new RequestWizard();
};

var Messages = {
	OPTIONS_USERFILTER: ext.i18n.getMessage('options_userfilter'),
	OPTIONS_WHITELIST: ext.i18n.getMessage('options_whitelist'),
	IN_WHITELIST: ext.i18n.getMessage('filtering_log_in_whitelist')
};

PageController.prototype = {

	init: function () {

		this.logTable = $("#logTable");
		this.logTableEmpty = $('#logTableEmpty');
		this.logTableHidden = true;

		this.tabSelector = $('#tabSelector');
		this.tabSelectorValue = this.tabSelector.find('.task-manager-header-dropdown-select-text');
		this.tabSelectorList = this.tabSelector.find('.task-manager-header-dropdown-select-list');

		this.logoIcon = $('#logoIcon');

		this.tabSelectorValue.dropdown();

		this.tabSelector.on('show.bs.dropdown', function () {
			this.tabSelector.addClass('opened');
		}.bind(this));
		this.tabSelector.on('hide.bs.dropdown', function () {
			this.tabSelector.removeClass('opened');
		}.bind(this));

		//bind on change of selected tab
		this.tabSelectorList.on('click', 'div', function (e) {
			var el = $(e.currentTarget);
			this.currentTabId = el.attr('data-tab-id');
			this.onSelectedTabChange();
		}.bind(this));

		this.searchRequest = null;
		this.searchTypes = [];
		this.searchThirdParty = false;
		this.searchBlocked = false;

		//bind click to reload tab
		$('.task-manager').on('click', '.reloadTab', function (e) {
			e.preventDefault();
			filteringLog.reloadTabById(this.currentTabId);
		}.bind(this));

		//bind click to clear events
		$('#clearTabLog').on('click', function (e) {
			e.preventDefault();
			filteringLog.clearEventsByTabId(this.currentTabId);
		}.bind(this));

		//bind click to show request info
		var self = this;
		this.logTable.on('click', '.task-manager-content-header-body-row', function () {
			var frameInfo = filteringLog.getTabFrameInfoById(self.currentTabId);
			if (!frameInfo) {
				return;
			}
			var filteringEvent = $(this).data();
			self.requestWizard.showRequestInfoModal(frameInfo, filteringEvent);
		});

		this._bindSearchFilters();

		//synchronize opened tabs
		filteringLog.synchronizeOpenTabs(this._onOpenedTabsReceived.bind(this));
	},

	_onOpenedTabsReceived: function () {
		//try to retrieve tabId from query string
		var tabId = UrlUtils.getParamValue(document.location.href, 'tabId');
		if (tabId) {
			this.currentTabId = tabId;
		}
		this.onSelectedTabChange();
	},

	onTabAdded: function (tabInfo) {
		//don't add not http tabs
		if (!tabInfo.isHttp) {
			return;
		}
		this.tabSelectorList.append($('<div>', {class: 'task-manager-header-dropdown-select-list-item', text: tabInfo.tab.title, 'data-tab-id': tabInfo.tabId}));
		if (!this.currentTabId) {
			this.onSelectedTabChange();
		}
	},

	onTabUpdated: function (tabInfo) {
		var item = this.tabSelectorList.find('[data-tab-id=' + tabInfo.tabId + ']');
		if (!tabInfo.isHttp) {
			//remove not http tabs
			this.onTabClose(tabInfo);
			return;
		}
		if (item && item.length > 0) {
			item.text(tabInfo.tab.title);
			if (tabInfo.tabId == this.currentTabId) {
				this.tabSelectorValue.text(tabInfo.tab.title);
				//update icon logo
				this._updateLogoIcon();
			}
		} else {
			this.onTabAdded(tabInfo);
		}
	},

	onTabClose: function (tabInfo) {
		this.tabSelectorList.find('[data-tab-id=' + tabInfo.tabId + ']').remove();
		if (this.currentTabId == tabInfo.tabId) {
			//current tab was removed
			this.currentTabId = null;
			this.onSelectedTabChange();
		}
	},

	onTabReset: function (tabInfo) {
		if (this.currentTabId == tabInfo.tabId) {
			this.logTable.empty();
			this._onEmptyTable();
		}
	},

	onEventAdded: function (tabInfo, event) {
		if (this.currentTabId != tabInfo.tabId) {
			//don't relate to the current tab
			return;
		}
		this._renderEvents([event]);
	},

	onSelectedTabChange: function () {
		var selectedItem = this.tabSelectorList.find('[data-tab-id="' + this.currentTabId + '"]');
		if (selectedItem.length == 0) {
			selectedItem = this.tabSelectorList.find(':first');
		}
		var text = '';
		var selectedTabId = null;
		if (selectedItem.length > 0) {
			text = selectedItem.text();
			selectedTabId = selectedItem.attr('data-tab-id');
		}
		this.currentTabId = selectedTabId;
		this.tabSelectorValue.text(text);
		this._updateLogoIcon();
		//render events
		this._renderEventsForTab(this.currentTabId);
	},

	_updateLogoIcon: function () {
		var frameInfo = filteringLog.getTabFrameInfoById(this.currentTabId);
		var src = 'skin/logpage/images/dropdown-logo.png';
		if (frameInfo && frameInfo.adguardDetected) {
			src = 'skin/logpage/images/dropdown-logo-blue.png';
		}
		this.logoIcon.attr('src', src);
	},

	_bindSearchFilters: function () {

		var self = this;

		//bind click to search http request
		$('[name="searchEventRequest"]').on('keyup', function () {
			self.searchRequest = this.value.trim();
			self._filterEvents();
		});

		//bind click to filter by type
		var searchEventTypeItems = $('.searchEventType');
		searchEventTypeItems.on('click', function (e) {

			e.preventDefault();

			searchEventTypeItems.parent().removeClass('active');

			var selectedItem = $(e.currentTarget);
			selectedItem.parent().addClass('active');
			var selectedValue = selectedItem.attr('attr-type');

			self.searchTypes = selectedValue ? selectedValue.split(',') : [];
			self._filterEvents();
		});

		//bind click to filter by third party
		$('[name="searchEventThirdParty"]').on('change', function (e) {
			self.searchThirdParty = this.checked;
			self._filterEvents();
		});

		//bind click to filter by blocked
		$('[name="searchEventBlocked"]').on('change', function () {
			self.searchBlocked = this.checked;
			self._filterEvents();
		})
	},

	_filterEvents: function () {

		var rows = this.logTable.children();

		//filters not set
		if (!this.searchRequest
			&& this.searchTypes.length == 0
			&& !this.searchThirdParty
			&& !this.searchBlocked) {

			rows.removeClass('hidden');
			return;
		}

		var self = this;
		$.each(rows, function () {
			self._handleEventShow($(this));
		});
	},

	_onEmptyTable: function () {
		this.logTableHidden = true;
		this.logTable.addClass('hidden');
		this.logTableEmpty.removeClass('hidden');
	},

	_onNotEmptyTable: function () {
		if (this.logTableHidden) {
			this.logTableHidden = false;
			this.logTableEmpty.addClass('hidden');
			this.logTable.removeClass('hidden');
		}
	},

	_renderEventsForTab: function (tabId) {

		this.logTable.empty();

		var tabInfo = filteringLog.getTabInfoById(tabId);

		var filteringEvents = [];
		if (tabInfo) {
			filteringEvents = tabInfo.filteringEvents || [];
		}

		this._renderEvents(filteringEvents);
	},

	_renderEvents: function (events) {
		if (!events || events.length == 0) {
			this._onEmptyTable();
			return;
		}
		var templates = [];
		for (var i = 0; i < events.length; i++) {
			var template = this._renderTemplate(events[i]);
			this._handleEventShow(template);
			templates.push(template);
		}
		this._onNotEmptyTable();
		this.logTable.append(templates);
	},

	_renderTemplate: function (event) {

		var metadata = {data: event, class: 'task-manager-content-header-body-row cf'};
		if (event.requestRule) {
			metadata.class += event.requestRule.whiteListRule ? ' green' : ' red';
		}

		var ruleText = '';
		if (event.requestRule) {
			if (event.requestRule.filterId === AntiBannerFiltersId.WHITE_LIST_FILTER_ID) {
				ruleText = Messages.IN_WHITELIST;
			} else {
				ruleText = event.requestRule.ruleText;
			}
		}

		var requestTypeClass = 'task-manager-content-header-body-col task-manager-content-item-type';
		if (event.requestThirdParty) {
			requestTypeClass += ' third-party';
		}

		var el = $('<div>', metadata);
		el.append($('<div>', {text: event.requestUrl, class: 'task-manager-content-header-body-col task-manager-content-item-url'}));
		el.append($('<div>', {text: RequestWizard.getRequestType(event.requestType), class: requestTypeClass}));
		el.append($('<div>', {text: ruleText, class: 'task-manager-content-header-body-col task-manager-content-item-rule'}));
		el.append($('<div>', {text: event.frameDomain, class: 'task-manager-content-header-body-col task-manager-content-item-source'}));

		return el;
	},

	_handleEventShow: function (el) {

		var filterData = el.data();

		var show = !this.searchRequest || StringUtils.containsIgnoreCase(filterData.requestUrl, this.searchRequest);
		show &= this.searchTypes.length == 0 || this.searchTypes.indexOf(filterData.requestType) >= 0;
		show &= !this.searchThirdParty || filterData.requestThirdParty;
		show &= !this.searchBlocked || (filterData.requestRule && !filterData.requestRule.whiteListRule);

		if (show) {
			el.removeClass('hidden');
		} else {
			el.addClass('hidden');
		}
	}
};

var RequestWizard = function () {
	this.requestInfoTemplate = $('#modal-request-info');
	this.createBlockRuleTemplate = $('#modal-create-block-rule');
	this.createExceptionRuleTemplate = $('#modal-create-exception-rule');
};

RequestWizard.getFilterName = function (filterId) {
	if (filterId == AntiBannerFiltersId.USER_FILTER_ID) {
		return Messages.OPTIONS_USERFILTER;
	}
	if (filterId == AntiBannerFiltersId.WHITE_LIST_FILTER_ID) {
		return Messages.OPTIONS_WHITELIST;
	}
	var filterMetadata = antiBannerService.getFilterMetadata(filterId);
	return filterMetadata ? filterMetadata.name : "";
};

RequestWizard.prototype.showModal = function (template) {

	$(document.body).append(template);
	template.show();

	template.modal();

	template.on('hidden.bs.modal', function () {
		$(this).remove();
	});

	this.currentModal = template;
};

RequestWizard.prototype.closeModal = function () {
	if (this.currentModal) {
		this.currentModal.modal('hide');
		this.currentModal = null;
	}
};

RequestWizard.prototype.showRequestInfoModal = function (frameInfo, filteringEvent) {

	var template = this.requestInfoTemplate.clone();

	var requestRule = filteringEvent.requestRule;

	template.find('[attr-text="requestUrl"]').text(filteringEvent.requestUrl);
	template.find('[attr-text="requestType"]').text(RequestWizard.getRequestType(filteringEvent.requestType));
	template.find('[attr-text="frameDomain"]').text(filteringEvent.frameDomain);
	if (requestRule) {
		if (requestRule.filterId != AntiBannerFiltersId.WHITE_LIST_FILTER_ID) {
			template.find('[attr-text="requestRule"]').text(requestRule.ruleText);
		} else {
			template.find('[attr-text="requestRule"]').closest('.adg-modal-window-locking-info-left-row').hide();
		}
		template.find('[attr-text="requestRuleFilter"]').text(RequestWizard.getFilterName(requestRule.filterId));
	} else {
		template.find('[attr-text="requestRule"]').closest('.adg-modal-window-locking-info-left-row').hide();
		template.find('[attr-text="requestRuleFilter"]').closest('.adg-modal-window-locking-info-left-row').hide();
	}

	if (filteringEvent.requestType == "IMAGE") {

		template.removeClass('compact-view');

		var imagePreview = template.find('[attr-src="requestUrl"]');
		var image = new Image();
		image.src = filteringEvent.requestUrl;
		image.onload = function () {
			var width = this.width;
			var height = this.height;
			if (width > 1 && height > 1) {
				imagePreview.attr('src', filteringEvent.requestUrl);
				imagePreview.parent().show();
			}
		}
	}

	//bind events
	template.find('#openRequestNewTab').on('click', function (e) {
		e.preventDefault();
		UI.openTab(filteringEvent.requestUrl, {inNewWindow: true});
	});

	var blockRequestButton = template.find('#blockRequest');
	var unblockRequestButton = template.find('#unblockRequest');
	var removeWhiteListDomainButton = template.find('#removeWhiteListDomain');
	var removeUserFilterRuleButton = template.find('#removeUserFilterRule');

	blockRequestButton.on('click', function (e) {
		e.preventDefault();
		this.closeModal();
		this.showCreateBlockRuleModal(frameInfo, filteringEvent);
	}.bind(this));

	unblockRequestButton.on('click', function (e) {
		e.preventDefault();
		this.closeModal();
		this.showCreateExceptionRuleModal(frameInfo, filteringEvent);
	}.bind(this));

	removeWhiteListDomainButton.on('click', function (e) {
		e.preventDefault();
		antiBannerService.unWhiteListFrame(frameInfo);
		this.closeModal();
	}.bind(this));

	removeUserFilterRuleButton.on('click', function (e) {
		e.preventDefault();
		if (frameInfo.adguardDetected) {
			adguardApplication.removeRuleFromApp(requestRule.ruleText, function () {
			});
		} else {
			antiBannerService.removeUserFilter(requestRule.ruleText);
		}
		this.closeModal();
	}.bind(this));

	if (!requestRule) {
		blockRequestButton.removeClass('hidden');
	} else {
		if (requestRule.filterId == AntiBannerFiltersId.USER_FILTER_ID) {
			removeUserFilterRuleButton.removeClass('hidden');
		} else if (requestRule.filterId == AntiBannerFiltersId.WHITE_LIST_FILTER_ID) {
			removeWhiteListDomainButton.removeClass('hidden');
		} else if (!requestRule.whiteListRule) {
			unblockRequestButton.removeClass('hidden');
		}
	}

	this.showModal(template);
};

RequestWizard.prototype.showCreateBlockRuleModal = function (frameInfo, filteringEvent) {

	var template = this.createBlockRuleTemplate.clone();

	var patterns = RequestWizard.splitToPatterns(filteringEvent.requestUrl, UrlFilterRule.MASK_START_URL).reverse();

	this._initCreateRuleDialog(frameInfo, template, patterns, filteringEvent.frameDomain, filteringEvent.requestThirdParty);
};

RequestWizard.prototype.showCreateExceptionRuleModal = function (frameInfo, filteringEvent) {

	var template = this.createExceptionRuleTemplate.clone();

	var prefix = FilterRule.MASK_WHITE_LIST + UrlFilterRule.MASK_START_URL;
	var patterns = RequestWizard.splitToPatterns(filteringEvent.requestUrl, prefix).reverse();

	this._initCreateRuleDialog(frameInfo, template, patterns, filteringEvent.frameDomain, filteringEvent.requestThirdParty);
};

RequestWizard.prototype._initCreateRuleDialog = function (frameInfo, template, patterns, urlDomain, isThirdPartyRequest) {
	var rulePatternsEl = template.find('#rulePatterns');
	for (var i = 0; i < patterns.length; i++) {
		var patternEl = $('<div>', {class: 'radio radio-patterns'});
		var input = $('<input>', {class: 'radio-input', type: 'radio', name: 'rulePattern', id: 'pattern' + i, value: patterns[i]});
		var label = $('<label>', {class: 'radio-label', for: 'pattern' + i}).append($('<span>', {class: 'radio-icon'})).append($('<span>', {class: 'radio-label-text', text: patterns[i]}));
		patternEl.append(input);
		patternEl.append(label);
		rulePatternsEl.append(patternEl);
		if (i == 0) {
			input.attr('checked', 'checked');
		}
	}

	var rulePatterns = template.find('[name="rulePattern"]');
	var ruleDomainCheckbox = template.find('[name="ruleDomain"]');
	var ruleMatchCaseCheckbox = template.find('[name="ruleMatchCase"]');
	var ruleThirdPartyCheckbox = template.find('[name="ruleThirdParty"]');
	var ruleTextEl = template.find('[name="ruleText"]');

	ruleDomainCheckbox.attr('id', 'ruleDomain');
	ruleDomainCheckbox.parent().find('label').attr('for', 'ruleDomain');

	ruleMatchCaseCheckbox.attr('id', 'ruleMatchCase');
	ruleMatchCaseCheckbox.parent().find('label').attr('for', 'ruleMatchCase');

	ruleThirdPartyCheckbox.attr('id', 'ruleThirdParty');
	ruleThirdPartyCheckbox.parent().find('label').attr('for', 'ruleThirdParty');
	if (isThirdPartyRequest) {
		ruleThirdPartyCheckbox.attr('checked', 'checked');
	}

	//bind events
	function updateRuleText() {

		var urlPattern = rulePatterns.filter(':checked').val();
		var permitDomain = !ruleDomainCheckbox.is(':checked');
		var matchCase = ruleMatchCaseCheckbox.is(':checked');
		var thirdParty = ruleThirdPartyCheckbox.is(':checked');

		var ruleText = RequestWizard.createRuleFromParams(urlPattern, urlDomain, permitDomain, matchCase, thirdParty);
		ruleTextEl.val(ruleText);
	}

	//update rule text events
	ruleDomainCheckbox.on('change', updateRuleText);
	ruleMatchCaseCheckbox.on('change', updateRuleText);
	ruleThirdPartyCheckbox.on('change', updateRuleText);
	rulePatterns.on('change', updateRuleText);

	//create rule event
	template.find('#createRule').on('click', function (e) {
		e.preventDefault();

		var rule = FilterRule.createRule(ruleTextEl.val());
		if (!rule) {
			//TODO: show error
			return;
		}
		//add rule to user filter
		if (frameInfo.adguardDetected) {
			adguardApplication.addRuleToApp(rule.ruleText, function () {
			});
		} else {
			antiBannerService.addUserFilterRule(rule.ruleText);
		}

		//close modal
		this.closeModal();
		//TODO: mark blocked line?

	}.bind(this));

	updateRuleText();

	this.showModal(template);
};

RequestWizard.PATTERNS_COUNT = 2; //exclude domain and full request url

RequestWizard.splitToPatterns = function (requestUrl, prefix) {

	var domain = UrlUtils.getDomainName(requestUrl);
	var patterns = [];//domain pattern

	var relative = StringUtils.substringAfter(requestUrl, domain + '/');

	var path = StringUtils.substringBefore(relative, '?');
	var query = StringUtils.substringAfter(relative, '?');

	if (path) {

		var parts = path.split('/');

		var pattern = domain + '/';
		for (var i = 0; i < Math.min(parts.length - 1, RequestWizard.PATTERNS_COUNT); i++) {
			pattern += parts[i] + '/';
			patterns.push(prefix + pattern + UrlFilterRule.MASK_ANY_SYMBOL);
		}
		var file = parts[parts.length - 1];
		if (file && patterns.length < RequestWizard.PATTERNS_COUNT) {
			pattern += file;
			patterns.push(prefix + pattern);
		}
	}

	//add domain pattern to start
	patterns.unshift(prefix + domain + UrlFilterRule.MASK_SEPARATOR);

	//push full url pattern
	var url = StringUtils.substringAfter(requestUrl, '//');
	if (StringUtils.startWith(url, 'www.')) {
		url = url.substring(4);
	}
	if (patterns.indexOf(prefix + url) < 0) {
		patterns.push(prefix + url);
	}

	return patterns;
};

RequestWizard.createRuleFromParams = function (urlPattern, urlDomain, permitDomain, matchCase, thirdParty) {

	var ruleText = urlPattern;
	var options = [];

	//add domain option
	if (permitDomain) {
		options.push(UrlFilterRule.DOMAIN_OPTION + '=' + urlDomain);
	}
	//add match case option
	if (matchCase) {
		options.push(UrlFilterRule.MATCH_CASE_OPTION);
	}
	//add third party option
	if (thirdParty) {
		options.push(UrlFilterRule.THIRD_PARTY_OPTION);
	}
	if (options.length > 0) {
		ruleText += UrlFilterRule.OPTIONS_DELIMITER + options.join(',');
	}
	return ruleText;
};

RequestWizard.getRequestType = function (requestType) {
	switch (requestType) {
		case 'DOCUMENT':
		case 'SUBDOCUMENT':
			return 'HTML';
		case 'STYLESHEET':
			return 'CSS';
		case 'SCRIPT':
			return 'JavaScript';
		case 'XMLHTTPREQUEST':
			return 'Ajax';
		case 'IMAGE':
			return 'Image';
		case 'OBJECT':
        case 'OBJECT-SUBREQUEST':
			return 'Media';
		case 'OTHER':
			return 'Other';
	}
	return '';
};

function init() {

	if (!backgroundPage.antiBannerService) {
		setTimeout(function () {
			init();
		}, 10);
		return;
	}

	antiBannerService = backgroundPage.antiBannerService;
	adguardApplication = backgroundPage.adguardApplication;
	UI = backgroundPage.UI;
	filteringLog = backgroundPage.filteringLog;
	EventNotifier = backgroundPage.EventNotifier;
	LogEvents = backgroundPage.LogEvents;
	UrlUtils = backgroundPage.UrlUtils;
	StringUtils = backgroundPage.StringUtils;
	AntiBannerFiltersId = backgroundPage.AntiBannerFiltersId;
	Utils = backgroundPage.Utils;

	FilterRule = backgroundPage.FilterRule;
	UrlFilterRule = backgroundPage.UrlFilterRule;

	$(document).ready(function () {

		var pageController = new PageController();

		function onEvent(event, tabInfo, filteringEvent) {
			switch (event) {
				case LogEvents.TAB_ADDED:
					pageController.onTabAdded(tabInfo);
					break;
				case LogEvents.TAB_UPDATE:
					pageController.onTabUpdated(tabInfo);
					break;
				case LogEvents.TAB_CLOSE:
					pageController.onTabClose(tabInfo);
					break;
				case LogEvents.TAB_RESET:
					pageController.onTabReset(tabInfo);
					break;
				case LogEvents.EVENT_ADDED:
					pageController.onEventAdded(tabInfo, filteringEvent);
					break;
			}
		}

		var events = [
			LogEvents.TAB_ADDED,
			LogEvents.TAB_UPDATE,
			LogEvents.TAB_CLOSE,
			LogEvents.TAB_RESET,
			LogEvents.EVENT_ADDED
		];

		//set log is open
		filteringLog.onOpenFilteringLogPage();
		//add listener for log events
		var listenerId = EventNotifier.addSpecifiedListener(events, onEvent);

		var onUnload = function () {
			if (listenerId) {
				EventNotifier.removeListener(listenerId);
				//set log is closed
				filteringLog.onCloseFilteringLogPage();
				listenerId = null;
			}
		};

		//unload event
		$(window).on('beforeunload', onUnload);
		$(window).on('unload', onUnload);

		pageController.init();
	});
}
init();