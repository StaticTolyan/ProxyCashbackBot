export function API() {
    let self = {};
    let config = Config();

    self.lang = config.lang;
    self._root = config.getDomain();
    self._api = config.getApiDomain();
    self.domain = config.getDomainWithoutProtocol();
    self._ps_api = 'https://proserfer.ru/api';

    self.sendSettingRequest = async function () {
        const response = await fetch(self._api+'setting/index');
        //console.log('response =>', response);
        return  await response.json();
    };

    self.user = function () {
        return self._api + 'user/profile';
    };

    self.newShops = function () {
        return self._api + 'shop/new-shops';
    };

    self.getAllOrders = function () {
        return self._api + 'order/my-orders';
    };

    self.checkUrl = function (url) {
        return self._api + 'shop/check?url='+url;
    };

    self.getGoRedirectShop = function (id, url) {
        return self._root + '/shop/go?id='+id+'&url='+url;
    };

    self.getGoUrl = function (id,url) {
        //for pop-up
        return self._root + '/shop/go?id='+id+'&url='+url;
    };

    self.getLoginUrl = function (returnLink=null) {
        return returnLink ? self._root + '/login?outUrl='+returnLink : self._root + '/login';
    };

    self.getPromoSurferBotCookie = function () {
        return self._ps_api + '/get-cookie';
    };

    self.getPromoSurferActivation = function () {
        return self._ps_api + '/reply';
    };

    self.getCashbackInstallCount = function (imei = null) {
        let result = self._root + '/extension/install-count?type=1';
        result = imei ? result + '&imei=' + imei : result;
        return result;
    };

    self.getCashbackAlive = function (installId, version, extensionId) {
        return self._root + '/extension/alive?installId='+installId+'&version='+version+'&extensionId='+extensionId;
    };

    self.getAllShopUrl = function () {
        return self._root + '/shop/all';
    };

    self.getOrdersUrl = function () {
        return self._root + '/profile/orders';
    };

    self.getFullUrlImg = function (url) {
        return self._root + url;
    };

    self.getReferralUrl = function (userId) {
        return self._root + '/go/'+userId;
    };

    return self;
}

import { Config } from '../config.js';