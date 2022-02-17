import {
    Chapter,
    ChapterDetails,
    ContentRating,
    HomeSection,
    Manga,
    MangaTile,
    PagedResults,
    SearchRequest,
    Request,
    Source,
    SourceInfo,
    RequestManager,
    TagType,
    SourceStateManager,
    Section,
} from 'paperback-extensions-common'

import { decodeHTMLEntity,
    ImageOptions,
    interceptResponse,
    spliterate } from '../LNInterceptor'
import { Parser } from './parser'

import { COLORS,
    getBackgroundColor,
    getFont,
    getTextColor,
    getFontSize,
    getImageWidth,
    getLinesPerPage,
    getHorizontalPadding,
    getVerticalPadding,
    getSettingsString,
    readerSettings } from './settings'

const LNPUB_DOMAIN    = 'https://www.lightnovelpub.com'
const REQUEST_RETRIES = 5
const TEXT_SELECTOR   = '#chapter-container > p'

export const LightNovelPubInfo: SourceInfo = {
    version: '0.0.1',
    name: 'LightNovelPub',
    description: 'Extension that pulls manga from LightNovelPub.',
    author: 'NmN',
    authorWebsite: 'http://github.com/pandeynmm',
    icon: 'icon.jpg',
    contentRating: ContentRating.EVERYONE,
    websiteBaseURL: LNPUB_DOMAIN,
    sourceTags: [
        {
            text: 'English',
            type: TagType.GREY,
        },
        {
            text: 'Light Novel',
            type: TagType.BLUE,
        },
    ],
}

export class LightNovelPub extends Source {
    parser = new Parser()
    stateManager: SourceStateManager = createSourceStateManager({})
    baseUrl = LNPUB_DOMAIN

    options = async(): Promise<ImageOptions> => {
        return {
            textColor: COLORS[(await getTextColor(this.stateManager)).toLowerCase().replace(' ', '_')],
            backgroundColor: COLORS[(await getBackgroundColor(this.stateManager)).toLowerCase().replace(' ', '_')],
            font: `${(await getFont(this.stateManager)).toLowerCase().replace(/ /g, '')}${await getFontSize(this.stateManager)}`,
            padding: {
                horizontal: await getHorizontalPadding(this.stateManager),
                vertical: await getVerticalPadding(this.stateManager)
            },
            width: await getImageWidth(this.stateManager),
            constantWidth: true,
            lines: await getLinesPerPage(this.stateManager)
        }
    }

    requestManager: RequestManager = createRequestManager({
        requestsPerSecond: 10,
        requestTimeout: 10000,
        interceptor: {
            interceptRequest: async (request) => {return request},
            interceptResponse: async (response) => {return interceptResponse(response, this.cheerio, await this.options(), TEXT_SELECTOR)}
        }
    })

    override async getSourceMenu(): Promise<Section> {
        return Promise.resolve(createSection({
            id: 'main',
            header: 'Source Settings',
            rows: async () => [
                await readerSettings(this.stateManager),
            ]
        }))
    }
    async getMangaDetails(mangaId: string): Promise<Manga> {
        const request = createRequestObject({
            url: `${this.baseUrl}/novel/${mangaId}`,
            method: 'GET',
        })
        const response = await this.requestManager.schedule(request, REQUEST_RETRIES)
        const $ = this.cheerio.load(response.data)
        return this.parser.parseMangaDetails($, mangaId)
    }
    async getChapters(mangaId: string): Promise<Chapter[]> {
        const request = createRequestObject({
            url: `${this.baseUrl}/novel/${mangaId}/chapters`,
            method: 'GET',
        })
        const response = await this.requestManager.schedule(request, REQUEST_RETRIES)
        const $ = this.cheerio.load(response.data)
        return this.parser.parseChapters($, mangaId, this)

    }
    async getChapterDetails(mangaId: string, chapterId: string): Promise<ChapterDetails> {
        const request = createRequestObject({
            url: `${this.baseUrl}/novel/${mangaId}/${chapterId}`,
            method: 'GET',
        })
        const response = await this.requestManager.schedule(request, REQUEST_RETRIES)
        const $ = this.cheerio.load(response.data)
        return this.setPageToIntercept($, mangaId, chapterId)
    }

    async getSearchResults(query: SearchRequest, metadata: any): Promise<PagedResults> {
        let page = metadata?.page ?? 1
        if (page == -1) return createPagedResults({ results: [], metadata: { page: -1 } })

        const tokenRequest = createRequestObject({
            url: `${this.baseUrl}/search`,
            method: 'GET',
        })

        const tokenResponse = await this.requestManager.schedule(tokenRequest, REQUEST_RETRIES)
        const $$ = this.cheerio.load(tokenResponse.data)
        const token = this.parser.parseToken($$)

        const request = createRequestObject({
            url: `${this.baseUrl}/lnsearchlive`,
            method: 'POST',
            headers: {
                'X-Requested-With': 'XMLHttpRequest',
                'LNRequestVerifyToken': token,
                'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10.15; rv:97.0) Gecko/20100101 Firefox/97.0',
                'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
                'Content-Length': '16',
                'Referer': 'https://www.lightnovelpub.com/search',

            },
            cookies: tokenResponse.request.cookies,
            data: `inputContent=${query.title?.replaceAll(' ', '+')}`

        })

        const response = await this.requestManager.schedule(request, REQUEST_RETRIES)
        try {
            const jsonData = JSON.parse(response.data)
            const $ = this.cheerio.load(jsonData.resultview)
            const manga = this.parser.parseSearchResults($)

            page = -1
            return createPagedResults({
                results: manga,
                metadata: { page: page },
            })
        } catch (error) {
            throw new Error('\n\nRefresh Cloudflare Cookies from the Source Settings\n\n')
        }
    }
    override async getHomePageSections(sectionCallback: (section: HomeSection) => void): Promise<void> {
        const request = createRequestObject({
            url: `${this.baseUrl}/hot`,
            method: 'GET',
        })
        const response = await this.requestManager.schedule(request, 2)
        const $ = this.cheerio.load(response.data)
        this.parser.parseHomeSections($, sectionCallback)
    }
    override async getViewMoreItems(homepageSectionId: string, metadata: any): Promise<PagedResults> {
        const page = metadata?.page ?? 1
        const request = createRequestObject({
            url: `${this.baseUrl}/${homepageSectionId}/${page}/`,
            method: 'GET'
        })
        const response = await this.requestManager.schedule(request, REQUEST_RETRIES)
        const $ = this.cheerio.load(response.data)
        const lastPage = parseInt($('div.pages > ul > li').children('a').last().text()) === page
        const htmlResults = $('div.ss-custom > div').toArray()
        const results: MangaTile[] = []
        for(const htmlResult of htmlResults) {
            const a = $('div.pic > a', htmlResult)
            results.push(createMangaTile({
                id: $(a).attr('href').substring(1).split('.')[0],
                title: createIconText({ text: $('img', a).attr('title')}),
                image: $('img', a).attr('src')
            }))
        }
        return createPagedResults({
            results: results,
            metadata: lastPage ? undefined : {page: page + 1}
        })
    }
    override getMangaShareUrl(mangaId: string): string {
        return `${this.baseUrl}/${mangaId}`
    }

    protected convertTime(timeAgo: string): Date {
        let time: Date
        let trimmed = Number((/\d*/.exec(timeAgo) ?? [])[0])
        trimmed = trimmed == 0 && timeAgo.includes('a') ? 1 : trimmed
        if (timeAgo.includes('mins') || timeAgo.includes('minutes') || timeAgo.includes('minute')) {
            time = new Date(Date.now() - trimmed * 60000)
        } else if (timeAgo.includes('hours') || timeAgo.includes('hour')) {
            time = new Date(Date.now() - trimmed * 3600000)
        } else if (timeAgo.includes('days') || timeAgo.includes('day')) {
            time = new Date(Date.now() - trimmed * 86400000)
        } else if (timeAgo.includes('year') || timeAgo.includes('years')) {
            time = new Date(Date.now() - trimmed * 31556952000)
        } else {
            time = new Date(timeAgo)
        }

        return time
    }

    override getCloudflareBypassRequest(): Request {
        return createRequestObject({
            url: `${this.baseUrl}/hot`,
            method: 'GET',
        })
    }

    private async setPageToIntercept($: CheerioStatic, mangaId: string, chapterId: string) {
        const pages: string[] = []
        const textSegments: string[] = []
        const chapterText = $(TEXT_SELECTOR).toArray()
        for(const chapterTextSeg of chapterText) {
            textSegments.push(decodeHTMLEntity($(chapterTextSeg).text()))
        }
        const text = textSegments.join('\n')
        const lines = Math.ceil(spliterate(text.replace(/[^\x00-\x7F]/g, ''), (await getImageWidth(this.stateManager))-(await getHorizontalPadding(this.stateManager))*2, `${(await getFont(this.stateManager)).toLowerCase().replace(/ /g, '')}${await getFontSize(this.stateManager)}`).split.length/(await getLinesPerPage(this.stateManager)))
        for(let i = 1; i <= lines; i++) {
            pages.push(`${this.baseUrl}/novel/${mangaId}/${chapterId}/?ttiparse&ttipage=${i}&ttisettings=${encodeURIComponent(await getSettingsString(this.stateManager))}`)
        }
        return createChapterDetails({
            id: chapterId,
            mangaId: mangaId,
            pages: pages,
            longStrip: false
        })
    }
}