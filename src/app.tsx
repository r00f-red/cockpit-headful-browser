/*
 * SPDX-License-Identifier: MIT
 *
 * Headful Browser - Run Chrome/Chromium on headless servers
 */

import React, { useEffect, useState, useCallback, useRef } from 'react';

import {
    Alert,
    Bullseye,
    Button,
    Card, CardBody, CardHeader, CardTitle,
    Checkbox,
    EmptyState,
    Flex,
    Form, FormGroup,
    Gallery, GalleryItem,
    Label,
    Page, PageSection,
    Toolbar, ToolbarContent, ToolbarItem,
} from "@patternfly/react-core";

import {
    CubesIcon,
    DesktopIcon,
    DownloadIcon,
    OutlinedSquareIcon,
    PlayIcon,
    RedoIcon,
    SyncIcon,
    ScreenIcon,
    StopIcon,
} from '@patternfly/react-icons';

import './app.scss';

// Mock cockpit for standalone development
const cockpit = (window as any).cockpit || {
    gettext: (text: string) => text,
    script: async (cmd: string, options?: any) => {
        console.log('Mock cockpit.script:', cmd);
        return 'inactive';
    },
    file: () => ({
        read: async () => null,
        watch: () => ({} as any),
        close: () => {},
    }),
    spawn: () => ({
        stream: () => {},
        close: () => {},
        catch: () => {},
    }),
};

const _ = cockpit.gettext;

// Constants
const SERVICE_NAME = 'headful-browser.service';
const VNC_PORT = 6900;
const CHROME_PORT = 9222;
const DISPLAY_NUM = ':99';

type ServiceStatus = {
    service: 'running' | 'stopped' | 'unknown';
    chrome: 'running' | 'stopped' | 'unknown';
    display: 'running' | 'stopped' | 'unknown';
};

type Screenshot = {
    name: string;
    path: string;
    url: string;
    time: string;
};

export const Application = () => {
    const [status, setStatus] = useState<ServiceStatus>({
        service: 'unknown',
        chrome: 'unknown',
        display: 'unknown',
    });
    const [isLoading, setIsLoading] = useState(false);
    const [autoRefresh, setAutoRefresh] = useState(true);
    const [vncUrl, setVncUrl] = useState<string | null>(null);
    const [screenshots, setScreenshots] = useState<Screenshot[]>([]);
    const [logs, setLogs] = useState<string>('');
    const [error, setError] = useState<string | null>(null);

    const logsRef = useRef<HTMLPreElement>(null);
    const intervalRef = useRef<NodeJS.Timeout | null>(null);
    const vncUrlRef = useRef<string | null>(null);
    const screenshotsBlobUrlsRef = useRef<Set<string>>(new Set());

    vncUrlRef.current = vncUrl;

    const checkStatus = useCallback(async () => {
        try {
            const result = await cockpit.script(
                `systemctl is-active ${SERVICE_NAME} 2>/dev/null || echo "inactive"`,
                { err: 'message' }
            );
            const serviceStatus = result.trim() as ServiceStatus['service'];

            if (serviceStatus !== 'running') {
                setStatus({ service: serviceStatus, chrome: 'unknown', display: 'unknown' });
                setVncUrl(null);
                return;
            }

            const [chromeResult, displayResult, vncResult] = await Promise.allSettled([
                cockpit.script(
                    `curl -s http://localhost:${CHROME_PORT}/json/version >/dev/null 2>&1 && echo "running" || echo "stopped"`,
                    { err: 'message' }
                ),
                cockpit.script(
                    `DISPLAY=${DISPLAY_NUM} xdpyinfo >/dev/null 2>&1 && echo "running" || echo "stopped"`,
                    { err: 'message' }
                ),
                autoRefresh && !vncUrlRef.current
                    ? cockpit.script(
                        `curl -s -o /dev/null -w "%{http_code}" http://localhost:${VNC_PORT} 2>/dev/null || echo "000"`,
                        { err: 'message' }
                    )
                    : Promise.resolve(null),
            ]);

            const chromeStatus =
                chromeResult.status === 'fulfilled'
                    ? (chromeResult.value as string).trim() as ServiceStatus['chrome']
                    : 'stopped';
            const displayStatus =
                displayResult.status === 'fulfilled'
                    ? (displayResult.value as string).trim() as ServiceStatus['display']
                    : 'stopped';

            setStatus({
                service: serviceStatus,
                chrome: chromeStatus,
                display: displayStatus,
            });

            if (
                vncResult.status === 'fulfilled' &&
                vncResult.value !== null &&
                !vncUrlRef.current
            ) {
                const code = String(vncResult.value).trim();
                if (code === '200' || code === '101' || code === '301') {
                    const hostname = window.location.hostname;
                    setVncUrl(`http://${hostname}:${VNC_PORT}/vnc.html?autoconnect=true&resize=scale&quality=6&compression=2&shared=true&view_only=false`);
                }
            }
        } catch (e) {
            setStatus({ service: 'unknown', chrome: 'unknown', display: 'unknown' });
        }
    }, [autoRefresh]);

    const startService = async () => {
        setIsLoading(true);
        setError(null);
        try {
            await cockpit.script(`sudo systemctl start ${SERVICE_NAME}`, { err: 'message' });
            appendLog(_('Service started'));
            setTimeout(checkStatus, 2000);
        } catch (e: unknown) {
            const message = e instanceof Error ? e.message : String(e);
            setError(_('Failed to start service: ') + message);
            appendLog(_('Failed to start: ') + message);
        } finally {
            setIsLoading(false);
        }
    };

    const stopService = async () => {
        setIsLoading(true);
        setError(null);
        try {
            await cockpit.script(`sudo systemctl stop ${SERVICE_NAME}`, { err: 'message' });
            setVncUrl(null);
            appendLog(_('Service stopped'));
            checkStatus();
        } catch (e: unknown) {
            const message = e instanceof Error ? e.message : String(e);
            setError(_('Failed to stop service: ') + message);
        } finally {
            setIsLoading(false);
        }
    };

    const restartService = async () => {
        setIsLoading(true);
        setError(null);
        try {
            await cockpit.script(`sudo systemctl restart ${SERVICE_NAME}`, { err: 'message' });
            setVncUrl(null);
            appendLog(_('Service restarted'));
            setTimeout(() => checkStatus(), 3000);
        } catch (e: unknown) {
            const message = e instanceof Error ? e.message : String(e);
            setError(_('Failed to restart service: ') + message);
        } finally {
            setIsLoading(false);
        }
    };

    const takeScreenshot = async () => {
        const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
        const filename = `screenshot-${timestamp}.png`;
        const filepath = `/tmp/headful-browser/${filename}`;

        appendLog(_('Taking screenshot...'));

        try {
            const result = await cockpit.script(`
                mkdir -p /tmp/headful-browser
                DISPLAY=${DISPLAY_NUM} import -window root "${filepath}" 2>/dev/null && echo "ok" || echo "failed"
            `, { err: 'message' });

            if (result.trim() === 'ok') {
                await loadScreenshot(filename, filepath);
            } else {
                await takeScreenshotFallback(filename, filepath);
            }
        } catch (e) {
            await takeScreenshotFallback(filename, filepath);
        }
    };

    const takeScreenshotFallback = async (filename: string, filepath: string) => {
        try {
            const result = await cockpit.script(`
                DISPLAY=${DISPLAY_NUM} xwd -root -out /tmp/headful-browser/temp.xwd 2>/dev/null && \
                convert /tmp/headful-browser/temp.xwd "${filepath}" 2>/dev/null && \
                rm /tmp/headful-browser/temp.xwd && echo "ok" || echo "failed"
            `, { err: 'message' });

            if (result.trim() === 'ok') {
                await loadScreenshot(filename, filepath);
            } else {
                appendLog(_('Screenshot failed: ImageMagick not installed'));
            }
        } catch (e) {
            appendLog(_('Screenshot failed'));
        }
    };

    const loadScreenshot = async (filename: string, filepath: string) => {
        try {
            const file = cockpit.file(filepath, { binary: true });
            const data = await file.read();
            if (data) {
                const blob = new Blob([data], { type: 'image/png' });
                const url = URL.createObjectURL(blob);
                screenshotsBlobUrlsRef.current.add(url);

                setScreenshots(prev => {
                    const newScreenshots = [{
                        name: filename,
                        path: filepath,
                        url,
                        time: new Date().toLocaleString(),
                    }, ...prev].slice(0, 12);
                    const removed = prev.filter(p => !newScreenshots.some(n => n.url === p.url));
                    removed.forEach(s => {
                        URL.revokeObjectURL(s.url);
                        screenshotsBlobUrlsRef.current.delete(s.url);
                    });
                    return newScreenshots;
                });

                appendLog(_('Screenshot saved: ') + filename);
            }
        } catch (e) {
            console.error('Failed to load screenshot:', e);
        }
    };

    const downloadScreenshot = (screenshot: Screenshot) => {
        const a = document.createElement('a');
        a.href = screenshot.url;
        a.download = screenshot.name;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
    };

    const clearScreenshots = () => {
        screenshotsBlobUrlsRef.current.forEach(url => URL.revokeObjectURL(url));
        screenshotsBlobUrlsRef.current.clear();
        setScreenshots([]);
    };

    const appendLog = (message: string) => {
        const timestamp = new Date().toLocaleTimeString();
        setLogs(prev => {
            const newLogs = prev + `[${timestamp}] ${message}\n`;
            const lines = newLogs.split('\n');
            return lines.slice(-500).join('\n');
        });
    };

    const clearLogs = () => setLogs('');

    useEffect(() => {
        if (logsRef.current) {
            logsRef.current.scrollTop = logsRef.current.scrollHeight;
        }
    }, [logs]);

    useEffect(() => {
        checkStatus();
        intervalRef.current = setInterval(checkStatus, 5000);
        return () => {
            if (intervalRef.current) clearInterval(intervalRef.current);
            screenshotsBlobUrlsRef.current.forEach(url => URL.revokeObjectURL(url));
            screenshotsBlobUrlsRef.current.clear();
        };
    }, [checkStatus]);

    const StatusLabel = ({ status: s, label }: { status: string; label: string }) => {
        const color = s === 'running' ? 'green' : s === 'stopped' ? 'red' : 'orange';
        return (
            <Label color={color}>
                {label}: {s === 'running' ? _('Running') : s === 'stopped' ? _('Stopped') : _('Unknown')}
            </Label>
        );
    };

    return (
        <Page>
            <PageSection variant="light">
                <div className="pf-c-content">
                    <h1><ScreenIcon /> {_('Remote Browser')}</h1>
                    <p>{_('Run headful Chrome/Chromium on headless servers with remote VNC access')}</p>
                </div>
            </PageSection>

            {error && (
                <PageSection>
                    <Alert
                        variant="danger"
                        title={error}
                        isInline
                        actionClose={<Button variant="plain" onClick={() => setError(null)}>×</Button>}
                    />
                </PageSection>
            )}

            <PageSection>
                <Card>
                    <CardHeader>
                        <Toolbar>
                            <ToolbarContent>
                                <ToolbarItem>
                                    <Flex spaceItems={{ default: 'spaceItemsSm' }}>
                                        <StatusLabel status={status.service} label={_('Service')} />
                                        <StatusLabel status={status.chrome} label={_('Chrome')} />
                                        <StatusLabel status={status.display} label={_('Display')} />
                                    </Flex>
                                </ToolbarItem>
                                <ToolbarItem variant="separator" />
                                <ToolbarItem>
                                    <Button
                                        variant="primary"
                                        icon={<PlayIcon />}
                                        onClick={startService}
                                        isDisabled={status.service === 'running' || isLoading}
                                    >
                                        {_('Start')}
                                    </Button>
                                </ToolbarItem>
                                <ToolbarItem>
                                    <Button
                                        variant="secondary"
                                        icon={<StopIcon />}
                                        onClick={stopService}
                                        isDisabled={status.service !== 'running' || isLoading}
                                    >
                                        {_('Stop')}
                                    </Button>
                                </ToolbarItem>
                                <ToolbarItem>
                                    <Button
                                        variant="secondary"
                                        icon={<RedoIcon />}
                                        onClick={restartService}
                                        isDisabled={status.service !== 'running' || isLoading}
                                    >
                                        {_('Restart')}
                                    </Button>
                                </ToolbarItem>
                                <ToolbarItem>
                                    <Button
                                        variant="secondary"
                                        icon={<OutlinedSquareIcon />}
                                        onClick={takeScreenshot}
                                        isDisabled={status.service !== 'running' || isLoading}
                                    >
                                        {_('Screenshot')}
                                    </Button>
                                </ToolbarItem>
                                <ToolbarItem>
                                    <Button
                                        variant="plain"
                                        icon={<SyncIcon />}
                                        onClick={checkStatus}
                                    >
                                        {_('Refresh')}
                                    </Button>
                                </ToolbarItem>
                            </ToolbarContent>
                        </Toolbar>
                    </CardHeader>

                    <CardBody>
                        <Form isHorizontal>
                            <FormGroup>
                                <Checkbox
                                    label={_('Auto refresh')}
                                    isChecked={autoRefresh}
                                    onChange={(_e: any, checked: boolean) => setAutoRefresh(checked)}
                                    id="auto-refresh-check"
                                />
                            </FormGroup>
                        </Form>
                    </CardBody>
                </Card>
            </PageSection>

            <PageSection>
                <Card style={{ minHeight: '600px' }}>
                    <CardBody>
                        {!vncUrl ? (
                            <Bullseye>
                                <EmptyState
                                    titleText={_('Browser not running')}
                                    icon={DesktopIcon}
                                >
                                    <p>{_('Click "Start" to launch Chrome with virtual display')}</p>
                                    <Button variant="primary" onClick={startService}>
                                        {_('Start Browser')}
                                    </Button>
                                </EmptyState>
                            </Bullseye>
                        ) : (
                            <iframe
                                src={vncUrl}
                                style={{
                                    width: '100%',
                                    height: '700px',
                                    border: 'none',
                                }}
                                title={_('Remote Browser VNC')}
                            />
                        )}
                    </CardBody>
                </Card>
            </PageSection>

            {screenshots.length > 0 && (
                <PageSection>
                    <Card>
                        <CardHeader>
                            <CardTitle>
                                <CubesIcon /> {_('Screenshots')}
                            </CardTitle>
                            <Button variant="plain" onClick={clearScreenshots}>
                                {_('Clear')}
                            </Button>
                        </CardHeader>
                        <CardBody>
                            <Gallery hasGutter minWidths={{ default: '200px' }}>
                                {screenshots.map((shot) => (
                                    <GalleryItem key={shot.name}>
                                        <Card isCompact>
                                            <CardBody>
                                                <img
                                                    src={shot.url}
                                                    alt={shot.name}
                                                    style={{ maxWidth: '100%', cursor: 'pointer' }}
                                                    onClick={() => window.open(shot.url, '_blank')}
                                                />
                                                <small>{shot.time}</small>
                                                <Button
                                                    variant="plain"
                                                    icon={<DownloadIcon />}
                                                    onClick={() => downloadScreenshot(shot)}
                                                />
                                            </CardBody>
                                        </Card>
                                    </GalleryItem>
                                ))}
                            </Gallery>
                        </CardBody>
                    </Card>
                </PageSection>
            )}

            <PageSection>
                <Card>
                    <CardHeader>
                        <CardTitle>
                            {_('Logs')}
                        </CardTitle>
                        <Button variant="plain" onClick={clearLogs}>
                            {_('Clear')}
                        </Button>
                    </CardHeader>
                    <CardBody>
                        <pre
                            ref={logsRef}
                            style={{
                                background: '#1e1e1e',
                                color: '#d4d4d4',
                                padding: '1rem',
                                maxHeight: '300px',
                                overflow: 'auto',
                                fontSize: '0.75rem',
                                fontFamily: 'monospace',
                            }}
                        >
                            {logs || _('Waiting for service...')}
                        </pre>
                    </CardBody>
                </Card>
            </PageSection>
        </Page>
    );
};
