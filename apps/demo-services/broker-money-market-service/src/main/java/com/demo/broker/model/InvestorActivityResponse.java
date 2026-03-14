package com.demo.broker.model;

public class InvestorActivityResponse {
    private String investorId;
    private String currency;
    private Integer dealCount;
    private Double totalOutstanding;
    private String topIssuerId;

    public String getInvestorId() { return investorId; }
    public void setInvestorId(String investorId) { this.investorId = investorId; }
    public String getCurrency() { return currency; }
    public void setCurrency(String currency) { this.currency = currency; }
    public Integer getDealCount() { return dealCount; }
    public void setDealCount(Integer dealCount) { this.dealCount = dealCount; }
    public Double getTotalOutstanding() { return totalOutstanding; }
    public void setTotalOutstanding(Double totalOutstanding) { this.totalOutstanding = totalOutstanding; }
    public String getTopIssuerId() { return topIssuerId; }
    public void setTopIssuerId(String topIssuerId) { this.topIssuerId = topIssuerId; }
}
