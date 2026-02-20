// Плагін: Kyivstar TV для Lampa
// Версія: 0.1 (на основі kyivstar_request.py 2026)
// Автор: адаптовано Grok для Serhii з Ужгорода

(function(){
    var manifest = {
        type: 'video',
        name: 'Київстар ТВ',
        version: '0.1',
        description: 'Київстар ТВ з логіном (телефон + OTP)',
        component: 'main'
    };

    var device_id = Lampa.Utils.md5(navigator.userAgent + Date.now()); // простий UUID-подібний
    var locale = 'uk_UA';
    var session_id = Lampa.Storage.get('kyivstar_session_id', '');
    var user_id = Lampa.Storage.get('kyivstar_user_id', 'anonymous');

    var headers = {
        'Origin': 'https://tv.kyivstar.ua',
        'Referer': 'https://tv.kyivstar.ua/',
        'User-Agent': navigator.userAgent,
        'x-vidmind-device-id': device_id,
        'x-vidmind-device-type': 'WEB',
        'x-vidmind-locale': locale
    };

    function apiPost(endpoint, body, use_jsession) {
        var url = 'https://clients.production.vidmind.com/vidmind-stb-ws/' + endpoint;
        if (use_jsession && session_id) url += ';jsessionid=' + session_id;

        return fetch(url, {
            method: 'POST',
            headers: Object.assign({'Content-Type': 'application/x-www-form-urlencoded'}, headers),
            body: new URLSearchParams(body).toString()
        }).then(r => {
            if (!r.ok) throw new Error('HTTP ' + r.status);
            return r.json();
        }).catch(e => {
            Lampa.Notice.show('Помилка API: ' + e.message);
            return null;
        });
    }

    function apiGet(endpoint, params = {}) {
        var url = 'https://clients.production.vidmind.com/vidmind-stb-ws/' + endpoint;
        if (session_id) url += ';jsessionid=' + session_id;
        if (Object.keys(params).length) url += '?' + new URLSearchParams(params);

        return fetch(url, { headers: headers })
            .then(r => {
                if (!r.ok) throw new Error('HTTP ' + r.status);
                return r.json();
            }).catch(e => {
                Lampa.Notice.show('Помилка: ' + e.message);
                return null;
            });
    }

    function loginFlow() {
        Lampa.Input.edit({
            title: 'Введіть номер телефону (+380...)',
            value: Lampa.Storage.get('kyivstar_phone', '')
        }, (value) => {
            if (!value) return;
            Lampa.Storage.set('kyivstar_phone', value);

            // 1. Анонімний старт для отримання sessionId
            apiPost('authentication/login', {
                username: '557455cfe4b04ad886a6ae41\\anonymous',
                password: 'anonymous'
            }).then(res => {
                if (!res || !res.jsessionid) {
                    Lampa.Notice.show('Помилка анонімного логіну');
                    return;
                }
                session_id = res.jsessionid; // або з cookies, але в fetch cookies автоматично
                Lampa.Storage.set('kyivstar_session_id', session_id);

                // 2. Надіслати OTP
                apiPost('v2/otp;jsessionid=' + session_id, {
                    phoneNumber: value,
                    language: 'UK',
                    channel: 'sms'
                }, false).then(() => {
                    Lampa.Input.edit({
                        title: 'Введіть код з SMS',
                        value: ''
                    }, (otp) => {
                        // 3. Логін з OTP
                        apiPost('authentication/login/v3;jsessionid=' + session_id, {
                            username: '557455cfe4b04ad886a6ae41\\' + value,
                            otp: otp
                        }).then(profile => {
                            if (profile && profile.userId) {
                                user_id = profile.userId;
                                Lampa.Storage.set('kyivstar_user_id', user_id);

Lampa.Notice.show('Успішний логін!');
                                Lampa.Activity.main();
                            } else {
                                Lampa.Notice.show('Невірний код');
                            }
                        });
                    });
                });
            });
        });
    }

    Lampa.Component.add(manifest.name, manifest, function(object){
        if (!session_id) {
            loginFlow();
            object.activity.loader(false);
            return;
        }

        // Завантажуємо групи каналів (LIVE_CHANNELS)
        apiGet('v1/contentareas/LIVE_CHANNELS', {includeRestricted: true, limit: 100}).then(groups => {
            if (!groups || !groups.length) {
                object.append([{title: 'Немає каналів', subtitle: 'Спробуйте перелогінитися'}]);
                return;
            }

            var items = groups.map(g => ({
                title: g.name || g.id,
                subtitle: 'Група каналів',
                img: g.image || '',
                data: g,
                action: function(){
                    // Тут можна завантажити канали з групи
                    apiGet('gallery/contentgroups/' + g.id, {offset:0, limit:500}).then(channels => {
                        var chan_items = (channels || []).map(c => ({
                            title: c.name,
                            subtitle: c.description || '',
                            img: c.image || c.logo,
                            url: function(){
                                apiGet('play/v2', {assetId: c.assetId}).then(stream => {
                                    if (stream && stream.liveChannelUrl) {
                                        Lampa.Player.play(stream.liveChannelUrl);
                                    } else if (stream && stream.media && stream.media[0]) {
                                        Lampa.Player.play(stream.media[0].url);
                                    } else {
                                        Lampa.Notice.show('Немає посилання на стрім');
                                    }
                                });
                            }
                        }));
                        Lampa.Activity.push({
                            title: g.name,
                            items: chan_items,
                            component: 'items_line'
                        });
                    });
                }
            }));

            object.append(items);
            object.activity.loader(false);
        });
    });

    Lampa.Manifests.add(manifest);
})();
