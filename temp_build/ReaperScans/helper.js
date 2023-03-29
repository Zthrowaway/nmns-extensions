"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.Helper = void 0;
class Helper {
    async createChapterRequestObject($, page, source) {
        const csrf = $('meta[name=csrf-token]').attr('content');
        const requestInfo = $('div.pb-4 div').attr('wire:initial-data');
        if (requestInfo === undefined || csrf === undefined)
            return {};
        const jsonObj = JSON.parse(requestInfo);
        const serverMemo = jsonObj.serverMemo ?? '';
        const fingerprint = jsonObj.fingerprint ?? '';
        const updates = JSON.parse(`[{"type":"callMethod","payload":{"id":"${(Math.random() + 1).toString(36).substring(8)}","method":"gotoPage","params":[${page.toString()},"page"]}}]`);
        const body = {
            'fingerprint': fingerprint,
            'serverMemo': serverMemo,
            'updates': updates
        };
        const request = createRequestObject({
            url: `${source.baseUrl}/livewire/message/${fingerprint.name ?? 'fingerprint.was_none'}`,
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'X-Livewire': 'true',
                'X-CSRF-TOKEN': csrf,
            },
            data: JSON.stringify(body),
        });
        const response = await source.requestManager.schedule(request, source.RETRY);
        source.CloudFlareError(response.status);
        const json = JSON.parse(response.data);
        if (!json || !json.effects || !json.effects.html)
            throw new Error('\n(ReaperScans) -> Chapter request returned no data. Contact support.\n');
        return json;
    }
    async createSearchRequestObject($, query, source) {
        const csrf = $('meta[name=csrf-token]').attr('content');
        const requestInfo = $('[wire\\:initial-data]').attr('wire:initial-data');
        if (requestInfo === undefined || csrf === undefined)
            return {};
        const jsonObj = JSON.parse(requestInfo);
        const serverMemo = jsonObj.serverMemo ?? '';
        const fingerprint = jsonObj.fingerprint ?? '';
        const updates = JSON.parse(`[{"type":"syncInput","payload":{"id":"${(Math.random() + 1).toString(36).substring(8)}","name":"query","value":"${query.title?.toLowerCase()}"}}]`);
        const body = {
            'fingerprint': fingerprint,
            'serverMemo': serverMemo,
            'updates': updates
        };
        const request = createRequestObject({
            url: `${source.baseUrl}/livewire/message/${fingerprint.name ?? 'fingerprint.was_none'}`,
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'X-Livewire': 'true',
                'X-CSRF-TOKEN': csrf,
            },
            data: JSON.stringify(body),
        });
        const response = await source.requestManager.schedule(request, source.RETRY);
        source.CloudFlareError(response.status);
        const json = JSON.parse(response.data);
        if (!json || !json.effects || !json.effects.html)
            throw new Error('\n(ReaperScans) -> Search request returned no data. Contact support.\n');
        return json;
    }
}
exports.Helper = Helper;
