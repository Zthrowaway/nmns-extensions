import {
    Chapter,
    ChapterDetails,
    ContentRating,
    HomeSection,
    PagedResults,
    SearchRequest,
    Request,
    Response,
    SourceInfo,
    SourceIntents,
    SourceManga,
    SourceStateManager,
    BadgeColor,
    SearchResultsProviding,
    MangaProviding,
    ChapterProviding,
    HomePageSectionsProviding,
} from '@paperback/types'

import { Parser } from './parser'
import { Helper } from './helper'

const MYREADINGMANGA_DOMAIN = 'https://myreadingmanga.info'
export const MyReadingMangaInfo: SourceInfo = {
    version: '4.0.3',
    name: 'MyReadingManga',
    description: 'MyReadingManga source for 0.8',
    author: 'Zili',
    authorWebsite: 'http://github.com/z-s-extensions',
    icon: 'icon.png',
    contentRating: ContentRating.ADULT,
    websiteBaseURL: MYREADINGMANGA_DOMAIN,
    sourceTags: [
        {
            text: 'English' 'Japanese' 'Korean' 'Spanish' 'Chinese' 'Portugese' 'Thai' 'French' 'Vietnamese' 'Bahasa Indonesia' 'Russian' 'Traditional Chinese' 'Italian' 'German',
            type: BadgeColor.GREY,
        },
    ],
    intents:
        SourceIntents.MANGA_CHAPTERS |
        SourceIntents.HOMEPAGE_SECTIONS |
        SourceIntents.CLOUDFLARE_BYPASS_REQUIRED,
}

export class MyReadingManga
    implements
        SearchResultsProviding,
        MangaProviding,
        ChapterProviding,
        HomePageSectionsProviding
{
    baseUrl = MYREADINGMANGA_DOMAIN
    stateManager: SourceStateManager = App.createSourceStateManager()
    constructor(private cheerio: CheerioAPI) {}
    RETRY = 5
    parser = new Parser()
    helper = new Helper()

    requestManager = App.createRequestManager({
        requestsPerSecond: 6,
        requestTimeout: 8000,
        interceptor: {
            interceptRequest: async (request: Request): Promise<Request> => {
                request.headers = {
                    ...(request.headers ?? {}),
                    ...{
                        'user-agent':
                            await this.requestManager.getDefaultUserAgent(),
                        referer: `${this.baseUrl}`,
                    },
                }
                return request
            },
            interceptResponse: async (
                response: Response
            ): Promise<Response> => {
                return response
            },
        },
    })

    getMangaShareUrl(mangaId: string): string {
        return `${this.baseUrl}/comics/${mangaId}`
    }

    async getMangaDetails(mangaId: string): Promise<SourceManga> {
        const request = App.createRequest({
            url: `${this.baseUrl}/comics/${mangaId}`,
            method: 'GET',
        })
        const response = await this.requestManager.schedule(request, this.RETRY)
        this.checkResponseError(response)
        const $ = this.cheerio.load(response.data)
        return this.parser.parseMangaDetails($, mangaId)
    }

    async getChapters(mangaId: string): Promise<Chapter[]> {
        const chapters: Chapter[] = []
        const request = App.createRequest({
            url: `${this.baseUrl}/comics/${mangaId}`,
            method: 'GET',
        })

        const response = await this.requestManager.schedule(request, this.RETRY)
        this.checkResponseError(response)
        const $ = this.cheerio.load(response.data)

        chapters.push(...this.parser.parseChapter($, mangaId, this))

        let page = 2
        let page_data: Chapter[] = []
        do {
            const json = await this.helper.createChapterRequestObject(
                $,
                page,
                this
            )
            page_data = this.parser.parseChapter(
                this.cheerio.load(json.effects.html),
                mangaId,
                this
            )
            chapters.push(...page_data)
            page += 1
        } while (page_data.length > 0)

        return chapters
    }

    async getChapterDetails(
        mangaId: string,
        chapterId: string
    ): Promise<ChapterDetails> {
        const request = App.createRequest({
            url: `${this.baseUrl}/comics/${mangaId}/chapters/${chapterId}`,
            method: 'GET',
        })
        const response = await this.requestManager.schedule(request, this.RETRY)
        const $ = this.cheerio.load(response.data)
        return this.parser.parseChapterDetails($, mangaId, chapterId)
    }
    async getSearchResults(
        query: SearchRequest,
        metadata: any
    ): Promise<PagedResults> {
        const page = metadata?.page ?? 1
        if (page == -1 || !query)
            return App.createPagedResults({
                results: [],
                metadata: { page: -1 },
            })
        const request = App.createRequest({
            url: `${this.baseUrl}`,
            method: 'GET',
        })
        const response = await this.requestManager.schedule(request, this.RETRY)
        this.checkResponseError(response)
        const $ = this.cheerio.load(response.data)
        const json = await this.helper.createSearchRequestObject($, query, this)
        const result = this.parser.parseSearchResults(
            this.cheerio.load(json.effects.html)
        )
        return App.createPagedResults({
            results: result,
            metadata: { page: -1 },
        })
    }

    async getViewMoreItems(
        homepageSectionId: string,
        metadata: any
    ): Promise<PagedResults> {
        let page = metadata?.page ?? 1
        if (page == -1)
            return App.createPagedResults({
                results: [],
                metadata: { page: -1 },
            })
        const request = App.createRequest({
            url: `${this.baseUrl}/latest/comics?page=${page.toString()}`,
            method: 'GET',
        })
        const response = await this.requestManager.schedule(request, this.RETRY)
        this.checkResponseError(response)
        const $ = this.cheerio.load(response.data)
        const result = this.parser.parseViewMore($)
        if (result.length < 1) page = -1
        else page++
        return App.createPagedResults({
            results: result,
            metadata: { page: page },
        })
    }
    async getHomePageSections(
        sectionCallback: (section: HomeSection) => void
    ): Promise<void> {
        const request = App.createRequest({
            url: this.baseUrl,
            method: 'GET',
            headers: {
                'user-agent': await this.requestManager.getDefaultUserAgent(),
                referer: `${this.baseUrl}/`,
            },
        })
        console.log(`url is ${this.baseUrl}`)
        const response = await this.requestManager.schedule(request, this.RETRY)
        console.log(`response is ${response.status}`)

        this.checkResponseError(response)
        const $ = this.cheerio.load(response.data)
        this.parser.parseHomeSections($, false, sectionCallback)
    }

    /**
     * Parses a time string from a Madara source into a Date object.
     * Copied from Madara.ts made by Netsky
     */
    protected convertTime(date: string): Date {
        date = date.toUpperCase()
        let time: Date
        const number = Number((/\d*/.exec(date) ?? [])[0])
        if (date.includes('LESS THAN AN HOUR') || date.includes('JUST NOW')) {
            time = new Date(Date.now())
        } else if (date.includes('YEAR') || date.includes('YEARS')) {
            time = new Date(Date.now() - number * 31556952000)
        } else if (date.includes('MONTH') || date.includes('MONTHS')) {
            time = new Date(Date.now() - number * 2592000000)
        } else if (date.includes('WEEK') || date.includes('WEEKS')) {
            time = new Date(Date.now() - number * 604800000)
        } else if (date.includes('YESTERDAY')) {
            time = new Date(Date.now() - 86400000)
        } else if (date.includes('DAY') || date.includes('DAYS')) {
            time = new Date(Date.now() - number * 86400000)
        } else if (date.includes('HOUR') || date.includes('HOURS')) {
            time = new Date(Date.now() - number * 3600000)
        } else if (date.includes('MINUTE') || date.includes('MINUTES')) {
            time = new Date(Date.now() - number * 60000)
        } else if (date.includes('SECOND') || date.includes('SECONDS')) {
            time = new Date(Date.now() - number * 1000)
        } else {
            time = new Date(date)
        }
        return time
    }

    async getCloudflareBypassRequest(): Promise<Request> {
        return App.createRequest({
            url: this.baseUrl,
            method: 'GET',
            headers: {
                'user-agent': await this.requestManager.getDefaultUserAgent(),
                referer: `${this.baseUrl}/`,
            },
        })
    }

    checkResponseError(response: Response): void {
        const status = response.status
        switch (status) {
            case 403:
            case 503:
                throw new Error(
                    this.createErrorString(
                        `Status: ${response.status}`,
                        'Cloudflare Error: Click the CLOUD icon.',
                        'If the issue persists, use #support in netsky\'s server.'
                    )
                )
            case 404:
                throw new Error(
                    this.createErrorString(
                        `Status: ${response.status}`,
                        'Webpage not found and the website likely changed domains.',
                        'Use #support in netsky\'s server.'
                    )
                )
        }
    }

    createErrorString(...errors: string[]): string {
        let ret = '\n<======>\n'
        for (const err of errors) {
            ret += `    • ${err}\n`
        }
        ret += '<======>\n'
        return ret
    }
}
