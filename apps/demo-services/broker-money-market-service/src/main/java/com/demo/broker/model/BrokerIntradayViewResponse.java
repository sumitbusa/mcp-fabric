package com.demo.broker.model;

public class BrokerIntradayViewResponse {
    private String broker;
    private String currency;
    private String intradayTimestamp;
    private Integer openDealCount;
    private Double openOutstanding;
    private String peakAccountId;
    private String peakInvestorId;
    private String peakIssuerId;

    public String getBroker() { return broker; }
    public void setBroker(String broker) { this.broker = broker; }
    public String getCurrency() { return currency; }
    public void setCurrency(String currency) { this.currency = currency; }
    public String getIntradayTimestamp() { return intradayTimestamp; }
    public void setIntradayTimestamp(String intradayTimestamp) { this.intradayTimestamp = intradayTimestamp; }
    public Integer getOpenDealCount() { return openDealCount; }
    public void setOpenDealCount(Integer openDealCount) { this.openDealCount = openDealCount; }
    public Double getOpenOutstanding() { return openOutstanding; }
    public void setOpenOutstanding(Double openOutstanding) { this.openOutstanding = openOutstanding; }
    public String getPeakAccountId() { return peakAccountId; }
    public void setPeakAccountId(String peakAccountId) { this.peakAccountId = peakAccountId; }
    public String getPeakInvestorId() { return peakInvestorId; }
    public void setPeakInvestorId(String peakInvestorId) { this.peakInvestorId = peakInvestorId; }
    public String getPeakIssuerId() { return peakIssuerId; }
    public void setPeakIssuerId(String peakIssuerId) { this.peakIssuerId = peakIssuerId; }
}
